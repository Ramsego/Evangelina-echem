# gamry_plotter/data.py — file parsing and data extraction functions.
# No plotting, no user interaction. All functions take arguments and return data.

import re
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.signal import find_peaks


# ─── DTA Metadata Extraction ──────────────────────────────────────────────────

# Keys present in Gamry DTA file headers that are useful for publication context.
_META_KEYS = {
    "TITLE", "DATE", "TIME", "NOTES", "OPERATOR",
    "PSTAT", "EXPLAIN", "SETUP", "GROUPID", "TAGS",
    # Technique-specific parameters
    "SCANRATE", "VLIMIT1", "VLIMIT2", "VINIT", "VFINAL",
    "FREQUENCY", "FREQINIT", "FREQFINAL", "NUMFREQ",
    "IRANGE", "IRCOMP",
}


def extract_dta_metadata(path: Path) -> dict[str, str]:
    """
    Parse the header section of a Gamry DTA file and return a dict of
    key-value pairs relevant to experimental context.

    Reads until the first CURVE TABLE line so only header fields are captured.
    Values are the raw strings as written by the Gamry software.
    """
    metadata: dict[str, str] = {}
    try:
        with open(path, "r", encoding="cp1252") as f:
            for line in f:
                if "CURVE" in line and "TABLE" in line:
                    break
                parts = line.split("\t")
                if len(parts) >= 2:
                    key = parts[0].strip()
                    if key in _META_KEYS:
                        if len(metadata) >= len(_META_KEYS):
                            break
                        if len(parts) >= 4:
                            # Gamry format: KEY  QUANT  VALUE  &Label
                            # parts[3] is the UI label (&-prefixed); parts[2] is the value.
                            # Older 5-col format: KEY  PSTAT  CHANNEL  VALUE  UNIT — value at [3].
                            p3 = parts[3].strip()
                            val = parts[2].strip() if p3.startswith('&') else p3
                            if val and '&' not in val:
                                metadata[key] = val
                        else:
                            # 2-column line — skip UI template labels (&prefix, type codes like F/D).
                            val = parts[1].strip()
                            if val and '&' not in val and not (len(val) <= 2 and val.isupper()):
                                if key not in metadata:
                                    metadata[key] = val
    except Exception:
        pass
    return metadata


# ─── Experiment Type Detection ─────────────────────────────────────────────────

def manual_detect_type(path: Path) -> str | None:
    """
    Detect the experiment type by reading the raw file header directly.

    Used as a fallback when gamry_parser fails. Checks the first 20 lines
    for a TAG line that identifies the experiment type.
    Returns a type string ('CV', 'LSV', 'EISPOT', 'CHRONOP') or None if unrecognised.
    """
    try:
        with open(path, 'r', encoding='cp1252') as f:
            for _ in range(20):
                line = f.readline()
                if 'TAG' in line and ('CHRONOPOTENTIOMETRY' in line or 'PWR800_CYCLICCHARGEDISCHARGE' in line):
                    return 'CHRONOP'
                if 'TAG' in line and 'EISPOT' in line:
                    return 'EISPOT'
                # LSV check must come before CV — 'LSV' does not contain 'CV' but
                # some Gamry firmware writes 'LINEARSWEEP' or 'LSV' on the TAG line.
                if 'TAG' in line and ('LSV' in line or 'LINEARSWEEP' in line):
                    return 'LSV'
                if 'TAG' in line and 'CV' in line:
                    return 'CV'
    except Exception:
        pass
    return None


# ─── GamryParser Extraction ────────────────────────────────────────────────────
# These two functions are the only place in the codebase that touches a
# GamryParser object. Everything downstream works with plain DataFrames.

def extract_cv_curves(gp) -> list[pd.DataFrame]:
    """
    Extract all CV curve DataFrames from a loaded GamryParser object.

    Returns a list of DataFrames, one per curve. Each DataFrame has at minimum
    'Vf' (potential in Volts) and 'Im' (current in Amps) columns.
    """
    return [gp.get_curve_data(i) for i in range(gp.get_curve_count())]


def extract_eis_df(gp) -> pd.DataFrame:
    """
    Extract the EIS data DataFrame from a loaded GamryParser object.

    Returns a single DataFrame with columns: Freq, Zreal, Zimag, Zmod, Zphz.
    EIS experiments always produce a single curve, so index 0 is always correct.
    """
    return gp.get_curve_data(0)


# ─── CV Analysis ───────────────────────────────────────────────────────────────

def _baseline_corrected_peak(seg_v: np.ndarray, seg_i: np.ndarray, peak_idx: int, margin: int) -> float:
    """
    Peak height above a linear baseline extrapolated from the pre-peak region.

    The baseline is fit to the points between the vertex margin and half-way
    to the peak — before the faradaic current starts rising — then evaluated
    at the peak potential. Falls back to the raw peak current when the sweep
    is too short to fit a baseline.
    """
    lo = margin
    hi = max(lo + 3, int(peak_idx * 0.5))
    if hi >= peak_idx or hi - lo < 3:
        return float(seg_i[peak_idx])
    slope, intercept = np.polyfit(seg_v[lo:hi], seg_i[lo:hi], 1)
    return float(seg_i[peak_idx] - (slope * seg_v[peak_idx] + intercept))


def find_cv_peaks(df: pd.DataFrame, prominence: float = 0.05) -> dict:
    """
    Find oxidation and reduction peaks in a CV curve using scipy.

    The curve is split into monotonic half-sweeps by voltage direction so that
    oxidation peaks are only searched on the anodic (V increasing) sweep and
    reduction peaks on the cathodic sweep. Peaks near the scan-reversal
    vertices are discarded as turnaround artifacts. Each peak also gets a
    baseline-corrected current (height above the extrapolated pre-peak
    baseline) — the i_p relevant for Randles–Ševčík analysis.

    Args:
        df: DataFrame with 'Vf' (Volts) and 'Im' (Amps) columns
        prominence: minimum peak height as a fraction of the total current range.

    Returns a dict with 'oxidation' and 'reduction' keys ('voltages',
    'currents', 'currents_corrected' arrays each), plus 'delta_ep_mv' and
    'peak_ratio' computed from the largest ox/red pair when both exist.
    """
    vf = df['Vf'].values
    current_ma = df['Im'].values * 1000  # Amps → milliamps

    data_range = current_ma.max() - current_ma.min()
    abs_prominence = prominence * data_range

    ox:  dict[str, list[float]] = {'voltages': [], 'currents': [], 'currents_corrected': []}
    red: dict[str, list[float]] = {'voltages': [], 'currents': [], 'currents_corrected': []}

    # Split into monotonic segments by carrying the sweep direction through
    # flat points (dv == 0) so noise at samples doesn't fragment the sweeps.
    dv_sign = np.sign(np.diff(vf))
    for i in range(1, len(dv_sign)):
        if dv_sign[i] == 0:
            dv_sign[i] = dv_sign[i - 1]
    boundaries = [0] + [int(k) + 1 for k in np.where(np.diff(dv_sign) != 0)[0]] + [len(vf) - 1]

    min_seg = max(10, len(vf) // 50)
    for s, e in zip(boundaries[:-1], boundaries[1:]):
        seg_v = vf[s:e + 1]
        seg_i = current_ma[s:e + 1]
        if len(seg_v) < min_seg:
            continue
        rising = seg_v[-1] > seg_v[0]
        # Search maxima on the anodic sweep, minima (inverted maxima) on the cathodic
        target = seg_i if rising else -seg_i
        margin = max(2, int(len(seg_v) * 0.02))
        idx, _ = find_peaks(target, prominence=abs_prominence)
        idx = idx[(idx >= margin) & (idx <= len(seg_v) - 1 - margin)]
        bucket = ox if rising else red
        for p in idx:
            corr = _baseline_corrected_peak(seg_v, target, int(p), margin)
            bucket['voltages'].append(float(seg_v[p]))
            bucket['currents'].append(float(seg_i[p]))
            bucket['currents_corrected'].append(corr if rising else -corr)

    delta_ep_mv = None
    peak_ratio = None
    if ox['voltages'] and red['voltages']:
        a = int(np.argmax(np.abs(ox['currents_corrected'])))
        c = int(np.argmax(np.abs(red['currents_corrected'])))
        delta_ep_mv = (ox['voltages'][a] - red['voltages'][c]) * 1000
        i_pc = red['currents_corrected'][c]
        if i_pc != 0:
            peak_ratio = abs(ox['currents_corrected'][a] / i_pc)

    return {
        'oxidation': {k: np.array(v) for k, v in ox.items()},
        'reduction': {k: np.array(v) for k, v in red.items()},
        'delta_ep_mv': delta_ep_mv,
        'peak_ratio': peak_ratio,
    }


def compute_cv_area(df: pd.DataFrame) -> float:
    """
    Compute the enclosed area of a CV curve using the trapezoidal rule.

    Integrates current (mA) over potential (V), giving units of mA·V.
    This is proportional to the charge passed per scan and is used to
    compare capacitive behaviour between samples.
    """
    return float(np.trapezoid(df['Im'].values * 1000, df['Vf'].values))


# ─── Dunn Analysis ─────────────────────────────────────────────────────────────

def _split_cv_sweeps(
    vf: np.ndarray,
    im_ma: np.ndarray,
) -> tuple[tuple[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]:
    """
    Split a bidirectional CV curve into anodic (V increasing) and cathodic
    (V decreasing) half-sweeps.  Returns ((v_an, i_an), (v_cat, i_cat)) where
    both voltage arrays are sorted ascending for np.interp compatibility.

    If the voltage is monotonic (e.g. LSV) the same sweep is returned for both.
    """
    if len(vf) < 4:
        return (vf, im_ma), (vf, im_ma)

    dv = np.diff(vf)
    sign_changes = np.where(np.diff(np.sign(dv)) != 0)[0] + 1

    # Discard sign-changes within the first/last 10% of the scan — these are
    # potentiostat noise at the turnaround, not real direction reversals.
    min_seg = max(5, len(vf) // 10)
    sign_changes = sign_changes[(sign_changes >= min_seg) & (sign_changes <= len(vf) - min_seg)]

    if len(sign_changes) == 0:
        # Monotonic — both halves are the same sweep
        order = np.argsort(vf)
        return (vf[order], im_ma[order]), (vf[order], im_ma[order])

    t1 = int(sign_changes[0])
    t2 = int(sign_changes[1]) if len(sign_changes) > 1 else len(vf) - 1

    # Use copies — slices share memory with vf, so sorting seg2_v in-place would
    # overwrite vf[t1] (the shared boundary point) and corrupt seg1_v's last element.
    seg1_v = vf[:t1 + 1].copy()
    seg1_i = im_ma[:t1 + 1].copy()
    seg2_v = vf[t1:t2 + 1].copy()
    seg2_i = im_ma[t1:t2 + 1].copy()

    # Assign by actual sweep direction, not time order — a cycle may start on
    # either the ascending or descending half (e.g. +1 → -1 → +1).
    if seg1_v[-1] >= seg1_v[0]:
        an_v, an_i, cat_v, cat_i = seg1_v, seg1_i, seg2_v, seg2_i
    else:
        an_v, an_i, cat_v, cat_i = seg2_v, seg2_i, seg1_v, seg1_i

    an_ord  = np.argsort(an_v)
    cat_ord = np.argsort(cat_v)
    return (an_v[an_ord], an_i[an_ord]), (cat_v[cat_ord], cat_i[cat_ord])


def _dunn_regression(
    sweeps: list[tuple[np.ndarray, np.ndarray]],
    sqrt_rates: np.ndarray,
    n_points: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None:
    """
    At each potential on a common voltage grid, fit i/√ν = k1·√ν + k2 (linear)
    across all scan rates to obtain k1(V) and k2(V).

    Returns (v_grid, k1, k2, r2) or None if the voltage ranges don't overlap.
    """
    v_lo = max(float(np.min(v)) for v, _ in sweeps)
    v_hi = min(float(np.max(v)) for v, _ in sweeps)
    if v_lo >= v_hi:
        return None

    v_grid = np.linspace(v_lo, v_hi, n_points)
    i_grid = np.array([
        np.interp(v_grid, v, i) for v, i in sweeps
    ])  # shape (n_entries, n_points)

    k1    = np.zeros(n_points)
    k2    = np.zeros(n_points)
    r2arr = np.zeros(n_points)
    x     = sqrt_rates  # shape (n_entries,)

    for idx in range(n_points):
        y_raw  = i_grid[:, idx]            # i at this potential for each ν
        y_norm = y_raw / x                 # i / √ν
        coeffs = np.polyfit(x, y_norm, 1)  # [k1, k2]
        k1[idx] = coeffs[0]
        k2[idx] = coeffs[1]
        y_pred  = np.polyval(coeffs, x)
        ss_res  = float(np.sum((y_norm - y_pred) ** 2))
        ss_tot  = float(np.sum((y_norm - float(np.mean(y_norm))) ** 2))
        r2arr[idx] = 1.0 - ss_res / ss_tot if ss_tot > 1e-15 else 1.0

    return v_grid, k1, k2, r2arr


def compute_dunn_analysis(
    entries: list[dict],
    target_scan_rate_mv: float,
    v_offset: float = 0.0,
    im_divisor: float = 1.0,
    n_points: int = 200,
) -> dict:
    """
    Dunn-method capacitive/diffusion current separation.

    i(V, ν) = k1(V)·ν + k2(V)·√ν
      k1·ν  → capacitive (surface-controlled)
      k2·√ν → diffusion-limited

    Entries: list of {'vf': [...], 'im': [...], 'scan_rate_mv': float}.
    Returns dict with concatenated anodic+cathodic arrays ready for plotting,
    plus the global capacitive fraction and mean regression R².
    """
    scan_rates_vs = np.array([e['scan_rate_mv'] / 1000.0 for e in entries])
    sqrt_rates    = np.sqrt(scan_rates_vs)

    # Apply offsets; split each curve into ascending anodic / cathodic half-sweeps
    anodic:   list[tuple[np.ndarray, np.ndarray]] = []
    cathodic: list[tuple[np.ndarray, np.ndarray]] = []

    for e in entries:
        vf = np.array(e['vf'], dtype=float) + v_offset
        im = np.array(e['im'], dtype=float) / im_divisor * 1000.0  # → mA
        an, cat = _split_cv_sweeps(vf, im)
        anodic.append(an)
        cathodic.append(cat)

    an_res  = _dunn_regression(anodic,   sqrt_rates, n_points)
    cat_res = _dunn_regression(cathodic, sqrt_rates, n_points)

    # Index of the target scan rate in entries
    target_sr_vs  = target_scan_rate_mv / 1000.0
    sqrt_target   = np.sqrt(target_sr_vs)
    target_idx    = int(np.argmin(np.abs(scan_rates_vs - target_sr_vs)))

    # Build output arrays (anodic low→high, then cathodic high→low)
    all_v: list[float] = []
    all_i_total: list[float] = []
    all_i_cap:   list[float] = []
    all_i_diff:  list[float] = []

    area_cap   = 0.0
    area_total = 0.0
    r2_vals:   list[float] = []

    def _add_half(result, sweeps, flip: bool) -> None:
        nonlocal area_cap, area_total
        if result is None:
            return
        v_grid, k1, k2, r2 = result
        r2_vals.extend(r2.tolist())

        i_cap_half = k1 * target_sr_vs
        v_t, i_t   = sweeps[target_idx]
        i_meas     = np.interp(v_grid, v_t, i_t)

        # Physical constraint: capacitive contribution must have the same sign as
        # the measured current and cannot exceed it in magnitude.
        same_sign     = np.sign(i_cap_half) == np.sign(i_meas)
        within_bounds = np.abs(i_cap_half) <= np.abs(i_meas)
        i_cap_half    = np.where(same_sign & within_bounds,
                                 i_cap_half,
                                 np.where(same_sign, i_meas, np.zeros_like(i_cap_half)))
        i_diff_half   = i_meas - i_cap_half

        area_cap   += float(np.trapezoid(np.abs(i_cap_half), v_grid))
        area_total += float(np.trapezoid(np.abs(i_meas),     v_grid))

        if flip:
            v_grid      = v_grid[::-1]
            i_cap_half  = i_cap_half[::-1]
            i_diff_half = i_diff_half[::-1]
            i_meas      = i_meas[::-1]

        all_v.extend(v_grid.tolist())
        all_i_cap.extend(i_cap_half.tolist())
        all_i_diff.extend(i_diff_half.tolist())
        all_i_total.extend(i_meas.tolist())

    _add_half(an_res,  anodic,   flip=False)
    _add_half(cat_res, cathodic, flip=True)

    cap_fraction = min(area_cap / area_total, 1.0) if area_total > 0.0 else 0.0
    r2_mean      = float(np.mean(r2_vals)) if r2_vals else 0.0

    return {
        'cap_fraction':  cap_fraction,
        'diff_fraction': 1.0 - cap_fraction,
        'r2_mean':       r2_mean,
        'voltages':      all_v,
        'i_total':       all_i_total,
        'i_cap':         all_i_cap,
        'i_diff':        all_i_diff,
    }


def _bvalue_regression(
    sweeps: list[tuple[np.ndarray, np.ndarray]],
    log_rates: np.ndarray,
    n_points: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """
    At each potential on a common voltage grid, fit log|i| = b·log(ν) + log(a)
    across all scan rates to obtain the power-law exponent b(V).

    The fit uses current magnitudes only — sign carries no information the
    power law can use, and log of a negative number is undefined. Points where
    any entry's current is ~0 (log blows up) are left as NaN.

    Returns (v_grid, b, r2).
    """
    v_lo = max(float(np.min(v)) for v, _ in sweeps)
    v_hi = min(float(np.max(v)) for v, _ in sweeps)
    if v_lo >= v_hi:
        return None

    v_grid = np.linspace(v_lo, v_hi, n_points)
    i_grid = np.array([
        np.interp(v_grid, v, i) for v, i in sweeps
    ])  # shape (n_entries, n_points)

    b     = np.full(n_points, np.nan)
    r2arr = np.full(n_points, np.nan)

    for idx in range(n_points):
        y = i_grid[:, idx]
        if np.min(np.abs(y)) < 1e-9:
            continue
        log_i  = np.log10(np.abs(y))
        coeffs = np.polyfit(log_rates, log_i, 1)
        b[idx] = coeffs[0]
        y_pred = np.polyval(coeffs, log_rates)
        ss_res = float(np.sum((log_i - y_pred) ** 2))
        ss_tot = float(np.sum((log_i - float(np.mean(log_i))) ** 2))
        r2arr[idx] = 1.0 - ss_res / ss_tot if ss_tot > 1e-15 else 1.0

    return v_grid, b, r2arr


def compute_bvalue_profile(
    entries: list[dict],
    v_offset: float = 0.0,
    im_divisor: float = 1.0,
    n_points: int = 200,
) -> dict:
    """
    Power-law (Lindström) exponent b(V), resolved across the whole sweep:
    fits log|i(V,ν)| = b(V)·log(ν) + log(a(V)) at every potential, using the
    same multi-scan-rate entries as the Dunn decomposition.
    b ≈ 1 → surface-controlled; b ≈ 0.5 → semi-infinite diffusion.

    Entries: list of {'vf': [...], 'im': [...], 'scan_rate_mv': float}.
    Returns {'anodic': {...} | None, 'cathodic': {...} | None}, each branch a
    dict of voltages/b/r2 arrays; b/r2 are None where any entry's current is
    ~0 (log undefined).
    """
    scan_rates_vs = np.array([e['scan_rate_mv'] / 1000.0 for e in entries])
    log_rates     = np.log10(scan_rates_vs)

    anodic:   list[tuple[np.ndarray, np.ndarray]] = []
    cathodic: list[tuple[np.ndarray, np.ndarray]] = []
    for e in entries:
        vf = np.array(e['vf'], dtype=float) + v_offset
        im = np.array(e['im'], dtype=float) / im_divisor * 1000.0  # → mA
        an, cat = _split_cv_sweeps(vf, im)
        anodic.append(an)
        cathodic.append(cat)

    def _branch(result) -> dict | None:
        if result is None:
            return None
        v_grid, b, r2 = result
        return {
            'voltages': v_grid.tolist(),
            'b':  [None if np.isnan(x) else float(x) for x in b],
            'r2': [None if np.isnan(x) else float(x) for x in r2],
        }

    return {
        'anodic':   _branch(_bvalue_regression(anodic,   log_rates, n_points)),
        'cathodic': _branch(_bvalue_regression(cathodic, log_rates, n_points)),
    }


# ─── GCD File Parsing ──────────────────────────────────────────────────────────

def organize_gcd_files(folder_path: Path) -> dict:
    """
    Scan a folder for individual cycle .dta files and group them by cycle number.

    Expects filenames like 'Charge_#1.dta' and 'Discharge_#1.dta'.
    Returns a dict: {cycle_number: {'charge': Path, 'discharge': Path}, ...}
    """
    buckets: dict = {}
    all_files = list(Path(folder_path).glob("*.[dD][tT][aA]"))

    for f in all_files:
        match = re.search(r'#?(\d+)', f.name)
        if not match:
            continue

        cycle_num = int(match.group(1))

        if cycle_num not in buckets:
            buckets[cycle_num] = {'charge': None, 'discharge': None}

        if f.name.upper().startswith('CHARGE_'):
            buckets[cycle_num]['charge'] = f
        elif f.name.upper().startswith('DISCHARGE_'):
            buckets[cycle_num]['discharge'] = f

    return buckets


def load_cycle_data(file_path: Path) -> tuple[list[float], list[float]]:
    """
    Manually parse a Gamry cycle .dta file and return (times, voltages).

    Reads directly from the raw text file because individual cycle files
    are not always supported by gamry_parser.
    """
    times: list[float] = []
    voltages: list[float] = []
    in_curve = False
    header_lines = 0

    with open(file_path, 'r', encoding='cp1252') as f:
        for line in f:
            line_str = line.strip()

            if 'CURVE' in line_str and 'TABLE' in line_str:
                in_curve = True
                header_lines = 0
                continue

            if not in_curve:
                continue

            if header_lines < 2:
                header_lines += 1
                continue

            parts = [p for p in line.split('\t') if p.strip()]
            if len(parts) < 3:
                continue

            try:
                times.append(float(parts[1]))     # column index 1 → T (seconds)
                voltages.append(float(parts[2]))  # column index 2 → Vf (Volts)
            except (ValueError, IndexError):
                continue

    return times, voltages



def load_gcd_master_waveforms(master_path: Path) -> dict[int, dict]:
    """
    Parse the CURVE TABLE from a master GCD file and split into per-cycle
    charge/discharge segments by using the sign of the measured current
    (Im > 0 = charging, Im < 0 = discharging).

    Returns {cycle_num: {'charge': {'times': [...], 'voltages': [...], 'currents': [...]},
                         'discharge': {...}}}

    Returns an empty dict if the CURVE TABLE is absent or has no Im column
    (some older file formats omit it).
    """
    all_t:  list[float] = []
    all_v:  list[float] = []
    all_im: list[float] = []
    idx_t = idx_v = idx_im = -1
    in_curve = False
    header_lines = 0

    try:
        with open(master_path, 'r', encoding='cp1252') as f:
            for line in f:
                line_str = line.strip()

                # Stop before the CAPACITYCURVE summary table
                if 'CAPACITYCURVE' in line_str and 'TABLE' in line_str:
                    break

                if 'CURVE' in line_str and 'TABLE' in line_str:
                    in_curve = True
                    header_lines = 0
                    continue

                if not in_curve:
                    continue

                if header_lines == 0:
                    # Column-name row — detect positions of T, Vf, Im
                    parts = line.split('\t')
                    for i, p in enumerate(parts):
                        pu = p.strip().upper()
                        if pu == 'T':    idx_t  = i
                        elif pu == 'VF': idx_v  = i
                        elif pu == 'IM': idx_im = i
                    header_lines += 1
                    continue

                if header_lines == 1:
                    # Units row — skip
                    header_lines += 1
                    continue

                if idx_t == -1 or idx_v == -1 or idx_im == -1:
                    continue

                parts = line.split('\t')
                if len(parts) <= max(idx_t, idx_v, idx_im):
                    continue

                try:
                    all_t.append(float(parts[idx_t]))
                    all_v.append(float(parts[idx_v]))
                    all_im.append(float(parts[idx_im]))
                except (ValueError, IndexError):
                    continue
    except Exception:
        return {}

    if len(all_im) < 10 or idx_im == -1:
        return {}

    im = np.array(all_im, dtype=float)
    t  = np.array(all_t,  dtype=float)
    v  = np.array(all_v,  dtype=float)

    # 1 % of median absolute current as noise threshold for charge/discharge detection
    nonzero = np.abs(im[np.abs(im) > 1e-12])
    median_abs = float(np.median(nonzero)) if len(nonzero) else 1e-6
    threshold  = 0.01 * median_abs
    is_charging = im > threshold

    # Find step transitions
    transitions = np.where(np.diff(is_charging.astype(int)) != 0)[0] + 1
    boundaries  = [0] + transitions.tolist() + [len(im)]

    # Discard noise-length segments (< 0.1 % of total points or < 5 points)
    min_len = max(5, len(im) // 1000)
    segments: list[dict] = []
    for i in range(len(boundaries) - 1):
        lo, hi = boundaries[i], boundaries[i + 1]
        if hi - lo < min_len:
            continue
        seg_t  = t[lo:hi].tolist()
        seg_v  = v[lo:hi].tolist()
        seg_im = im[lo:hi].tolist()
        # Pre-compute discharge energy for this segment (mWh)
        if hi - lo > 1:
            dt_arr   = np.diff(t[lo:hi])
            v_mid    = (v[lo:hi - 1] + v[lo + 1:hi]) / 2
            im_mid   = np.abs((im[lo:hi - 1] + im[lo + 1:hi]) / 2)
            e_mwh    = float(np.sum(v_mid * im_mid * dt_arr)) / 3.6
        else:
            e_mwh = 0.0
        segments.append({
            'times':     seg_t,
            'voltages':  seg_v,
            'currents':  seg_im,
            'is_charge': bool(is_charging[lo]),
            'energy_mwh': e_mwh,
        })

    # Group into cycles — each cycle gets one charge and one discharge segment.
    # A repeated step type signals the start of the next cycle.
    result: dict[int, dict] = {}
    cycle_n = 1
    for seg in segments:
        step = 'charge' if seg['is_charge'] else 'discharge'
        if cycle_n not in result:
            result[cycle_n] = {}
        if step in result[cycle_n]:
            cycle_n += 1
            result[cycle_n] = {}
        result[cycle_n][step] = {
            'times':      seg['times'],
            'voltages':   seg['voltages'],
            'currents':   seg['currents'],
            'energy_mwh': seg['energy_mwh'],
        }

    return result


def get_gcd_master_data(master_path: Path) -> tuple[tuple, dict]:
    """
    Parse the GCD master summary file to extract per-cycle capacity and duration data.

    Returns:
        ((cycles_list, discharge_caps, charge_by_cycle), durations)
        - cycles_list:       list of discharge cycle numbers
        - discharge_caps:    discharge capacity in Coulombs per cycle
        - charge_by_cycle:   dict of {cycle_num: charge_coulombs}
        - durations:         dict of {cycle: {
                               'charge': s, 'discharge': s,
                               'dis_energy_j': J,   # discharge energy (J) — PWR800 only
                               'chg_energy_j': J,   # charge energy (J)    — PWR800 only
                             }}

    Handles both standard CHRONOP and PWR800 formats by detecting column positions
    dynamically from the header row.
    """
    durations: dict = {}
    cycles_list: list[int] = []
    discharge_caps: list[float] = []
    charge_by_cycle: dict[int, float] = {}

    idx_cycle = idx_type = idx_charge = idx_duration = idx_capacity = -1
    idx_energy = -1  # present in PWR800 files

    with open(master_path, 'r', encoding='cp1252') as f:
        in_table = False
        header_found = False

        for line in f:
            line_str = line.strip()

            if 'CAPACITYCURVE' in line_str and 'TABLE' in line_str:
                in_table = True
                continue

            if not in_table:
                continue

            if not header_found:
                if 'Cycle' in line_str and ('Charge' in line_str or 'Capacity' in line_str):
                    parts = line_str.split()
                    for i, p in enumerate(parts):
                        if p == 'Cycle':      idx_cycle    = i
                        elif p == 'Type':     idx_type     = i
                        elif p == 'Charge':   idx_charge   = i
                        elif p == 'Capacity': idx_capacity = i
                        elif p == 'Duration': idx_duration = i
                        elif p == 'Energy':   idx_energy   = i

                    header_found = True

                    if idx_charge == -1 and idx_capacity != -1:
                        idx_charge = idx_capacity
                continue

            if not line_str or idx_cycle == -1:
                continue

            parts = line_str.split()

            if len(parts) < max(idx_cycle, idx_charge) + 1:
                continue

            try:
                c_num = int(float(parts[idx_cycle]))

                # Type column: 0 = Charge, 1 = Discharge (standard Gamry convention)
                is_discharge = False
                if idx_type != -1:
                    if parts[idx_type] in ('1', '1.0'):
                        is_discharge = True

                if c_num not in durations:
                    durations[c_num] = {'charge': 0, 'discharge': 0}

                step_key = 'discharge' if is_discharge else 'charge'

                if idx_duration != -1:
                    durations[c_num][step_key] = float(parts[idx_duration])

                if idx_energy != -1 and len(parts) > idx_energy:
                    energy_key = 'dis_energy_j' if is_discharge else 'chg_energy_j'
                    durations[c_num][energy_key] = float(parts[idx_energy])

                if idx_charge != -1:
                    if is_discharge:
                        cycles_list.append(c_num)
                        discharge_caps.append(float(parts[idx_charge]))
                    else:
                        charge_by_cycle[c_num] = float(parts[idx_charge])

            except (ValueError, IndexError):
                continue

    return (cycles_list, discharge_caps, charge_by_cycle), durations
