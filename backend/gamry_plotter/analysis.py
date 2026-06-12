# gamry_plotter/analysis.py — single-file electrochemical analysis functions.
# All functions are pure: they take data arrays/DataFrames and return results.
# No Streamlit, no plotting — those live in app.py.

import numpy as np
import pandas as pd
from scipy import stats
from scipy.optimize import least_squares


# ─── CV / LSV ──────────────────────────────────────────────────────────────────

def cv_capacitance(
    curves: list[pd.DataFrame],
    scan_rate_mv: float,
    v_lo: float | None = None,
    v_hi: float | None = None,
) -> list[float]:
    """
    Capacitance in Farads per curve using C = ∫I dV / (2·v·ΔV).

    Im must be in Amps, Vf in Volts, scan_rate_mv in mV/s.
    v_lo / v_hi optionally restrict the integration window (same units as Vf).
    """
    v = scan_rate_mv / 1e3  # V/s
    caps = []
    for df in curves:
        sub = df.copy()
        if v_lo is not None:
            sub = sub[sub["Vf"] >= v_lo]
        if v_hi is not None:
            sub = sub[sub["Vf"] <= v_hi]
        if sub.empty:
            caps.append(0.0)
            continue
        dv = float(sub["Vf"].max() - sub["Vf"].min())
        if dv == 0 or v == 0:
            caps.append(0.0)
            continue
        area = float(np.trapezoid(sub["Im"].values, sub["Vf"].values))  # A·V
        caps.append(abs(area) / (2 * v * dv))
    return caps


def tafel_analysis(
    df: pd.DataFrame,
    area_cm2: float,
    v_min: float,
    v_max: float,
) -> dict | None:
    """
    Tafel slope and apparent exchange current density from a user-selected
    potential window [v_min, v_max].

    Fits log₁₀|j| vs E via linear regression.
    Returns None if fewer than 5 valid points exist in the window.

    slope_mv_dec : Tafel slope in mV/decade (always positive)
    j0_mA_cm2   : apparent j₀ extrapolated to E = 0 (mA/cm²)
    r2           : coefficient of determination of the linear fit
    fit_v / fit_log_j : arrays for drawing the fitted line on a Tafel plot
    """
    sub = df[(df["Vf"] >= v_min) & (df["Vf"] <= v_max)].copy()
    if len(sub) < 5:
        return None

    j     = sub["Im"].values * 1e3 / area_cm2   # mA/cm²
    valid = np.abs(j) > 0
    if valid.sum() < 5:
        return None

    v_pts  = sub["Vf"].values[valid]
    log_j  = np.log10(np.abs(j[valid]))

    res = stats.linregress(v_pts, log_j)
    if res.slope == 0:
        return None

    v_line    = np.linspace(v_pts.min(), v_pts.max(), 200)
    logj_line = res.slope * v_line + res.intercept

    return {
        "slope_mv_dec": abs(1e3 / res.slope),
        # propagation of m → 1000/m: δ = 1000·δm/m²
        "slope_err_mv_dec": abs(1e3 * res.stderr / res.slope ** 2),
        "j0_mA_cm2":    10 ** res.intercept,
        "r2":           res.rvalue ** 2,
        "fit_v":        v_line,
        "fit_log_j":    logj_line,
        "n_points":     int(valid.sum()),
    }


# ─── EIS ───────────────────────────────────────────────────────────────────────

def eis_esr(df: pd.DataFrame) -> float:
    """Z' at the highest measured frequency — equivalent series resistance (Ω)."""
    return float(df.loc[df["Freq"].idxmax(), "Zreal"])


def eis_complex_capacitance(df: pd.DataFrame) -> pd.DataFrame:
    """
    Complex capacitance representation of EIS data.

    C'(f)  = -Z'' / (ω |Z|²)   [real part — stored energy]
    C''(f) =  Z'  / (ω |Z|²)   [imaginary part — dissipated energy]

    Units: Farads. Normalise by mass/area in the caller.
    """
    omega    = 2 * np.pi * df["Freq"].values
    z_mod_sq = df["Zmod"].values ** 2
    safe     = omega > 0
    c_prime  = np.where(safe, -df["Zimag"].values / (omega * z_mod_sq), np.nan)
    c_dbl    = np.where(safe,  df["Zreal"].values / (omega * z_mod_sq), np.nan)
    return pd.DataFrame({"Freq": df["Freq"].values,
                         "C_prime": c_prime,
                         "C_dbl":   c_dbl})


def eis_relaxation_time(c_df: pd.DataFrame) -> float | None:
    """
    Characteristic relaxation time τ₀ = 1 / (2π f₀).
    f₀ is the frequency at the peak of C''(f).
    """
    col = c_df["C_dbl"].dropna()
    if col.empty:
        return None
    f0 = c_df.loc[col.idxmax(), "Freq"]
    return 1.0 / (2 * np.pi * f0)


def _z_randles(w, p):
    R_s, R_ct, C_dl = p
    return R_s + R_ct / (1.0 + 1j * w * R_ct * C_dl)


def _z_randles_cpe(w, p):
    R_s, R_ct, Q, alpha = p
    return R_s + R_ct / (1.0 + (1j * w) ** alpha * Q * R_ct)


def _z_randles_cpe_warburg(w, p):
    # Textbook Randles: CPE in parallel with (R_ct + Warburg)
    R_s, R_ct, Q, alpha, sigma = p
    z_w = sigma * (1.0 - 1j) / np.sqrt(w)
    return R_s + 1.0 / ((1j * w) ** alpha * Q + 1.0 / (R_ct + z_w))


# name → (z_func, param names, bounds builder). Initial guesses computed per-dataset.
_MODELS = {
    "randles": (
        _z_randles,
        ["R_s", "R_ct", "C_dl"],
        ([0.0, 0.0, 1e-9], [np.inf, np.inf, np.inf]),
    ),
    "randles_cpe": (
        _z_randles_cpe,
        ["R_s", "R_ct", "Q", "alpha"],
        ([0.0, 0.0, 1e-12, 0.3], [np.inf, np.inf, np.inf, 1.0]),
    ),
    "randles_cpe_warburg": (
        _z_randles_cpe_warburg,
        ["R_s", "R_ct", "Q", "alpha", "sigma"],
        ([0.0, 0.0, 1e-12, 0.3, 0.0], [np.inf, np.inf, np.inf, 1.0, np.inf]),
    ),
}


def _initial_guess(df: pd.DataFrame, model: str) -> list[float]:
    R_s0  = float(df.loc[df["Freq"].idxmax(), "Zreal"])
    R_ct0 = max(float(df["Zreal"].max()) - R_s0, 1.0)
    if model == "randles":
        return [R_s0, R_ct0, 1e-4]
    alpha0 = 0.9
    # Q from semicircle apex: for ideal C, ω_apex = 1/(R_ct·C)
    neg_zimag = -df["Zimag"].values
    if neg_zimag.max() > 0:
        w_apex = 2 * np.pi * float(df["Freq"].values[np.argmax(neg_zimag)])
        Q0 = 1.0 / (w_apex ** alpha0 * R_ct0) if w_apex > 0 else 1e-4
    else:
        Q0 = 1e-4
    if model == "randles_cpe":
        return [R_s0, R_ct0, Q0, alpha0]
    # Warburg: attribute low-frequency tail beyond the semicircle to σ/√ω
    fmin_row = df.loc[df["Freq"].idxmin()]
    w_min    = 2 * np.pi * float(fmin_row["Freq"])
    sigma0   = max((float(fmin_row["Zreal"]) - R_s0 - R_ct0) * np.sqrt(w_min), 1.0)
    return [R_s0, R_ct0, Q0, alpha0, sigma0]


def _fit_one(df: pd.DataFrame, model: str) -> dict | None:
    z_func, names, bounds = _MODELS[model]
    omega  = 2 * np.pi * df["Freq"].values
    z_meas = df["Zreal"].values + 1j * df["Zimag"].values
    z_mod  = np.abs(z_meas)

    # Modulus-weighted residuals: Warburg tails span decades of |Z|; unweighted
    # fits ignore the high-frequency intercept. Same weighting for all models
    # keeps AICc comparable.
    def residuals(p):
        diff = (z_func(omega, p) - z_meas) / z_mod
        return np.concatenate([diff.real, diff.imag])

    try:
        result = least_squares(
            residuals, _initial_guess(df, model),
            bounds=bounds, method="trf", max_nfev=5000,
        )
        if not np.all(np.isfinite(result.x)):
            return None
        z_fit = z_func(omega, result.x)
        rmse  = float(np.sqrt(np.mean(np.abs(z_fit - z_meas) ** 2)))

        n   = 2 * len(df)
        p_n = len(result.x)
        ssr = 2 * result.cost
        # AICc: small-sample correction matters at typical EIS point counts
        aic = n * np.log(max(ssr / n, 1e-300)) + 2 * p_n
        if n - p_n - 1 > 0:
            aic += 2 * p_n * (p_n + 1) / (n - p_n - 1)

        errors: dict | None = None
        dof = n - p_n
        if dof > 0:
            try:
                cov    = (ssr / dof) * np.linalg.inv(result.jac.T @ result.jac)
                stderr = np.sqrt(np.diag(cov))
                if np.all(np.isfinite(stderr)):
                    errors = dict(zip(names, stderr.tolist()))
            except np.linalg.LinAlgError:
                pass

        return {
            "model":     model,
            "params":    dict(zip(names, result.x.tolist())),
            "errors":    errors,
            "rmse":      rmse,
            "aic":       float(aic),
            "fit_zreal": z_fit.real.tolist(),
            "fit_zimag": z_fit.imag.tolist(),
        }
    except Exception:
        return None


def eis_circuit_fit(df: pd.DataFrame, model: str = "auto") -> dict | None:
    """
    Fit an equivalent circuit to Nyquist data.

    Models:
      randles             Z = R_s + R_ct / (1 + jω·R_ct·C_dl)
      randles_cpe         Z = R_s + R_ct / (1 + (jω)^α·Q·R_ct)
      randles_cpe_warburg Z = R_s + 1/((jω)^α·Q + 1/(R_ct + σ(1−j)/√ω))

    model="auto" fits all three and picks the lowest AICc.
    Returns dict with model, params, errors (1σ from Jacobian covariance,
    or None if covariance is singular), rmse (Ω, unweighted), aic,
    fit_zreal, fit_zimag — or None if no model converges.

    Zimag convention: negative for capacitive behaviour (same as Gamry files).
    """
    df = df[df["Freq"] > 0]
    if len(df) < 5:
        return None

    if model != "auto":
        return _fit_one(df, model)

    fits = [f for m in _MODELS if (f := _fit_one(df, m)) is not None]
    if not fits:
        return None
    return min(fits, key=lambda f: f["aic"])


