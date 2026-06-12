import logging
from typing import Literal

import numpy as np
import pandas as pd
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator, model_validator

from gamry_plotter.analysis import (
    cv_capacitance,
    eis_complex_capacitance,
    eis_esr,
    eis_circuit_fit,
    eis_relaxation_time,
    tafel_analysis,
)
from gamry_plotter.data import compute_cv_area, compute_dunn_analysis, find_cv_peaks
from limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter()

_MAX_PTS    = 20_000
_MAX_CURVES = 50


# ── Request models ────────────────────────────────────────────────────────────

class Curve(BaseModel):
    vf: list[float]
    im: list[float]

    @field_validator("vf", "im")
    @classmethod
    def _check_len(cls, v: list[float]) -> list[float]:
        if len(v) > _MAX_PTS:
            raise ValueError(f"array exceeds {_MAX_PTS}-point limit")
        return v

    @model_validator(mode="after")
    def _check_matching_lengths(self) -> "Curve":
        if len(self.vf) != len(self.im):
            raise ValueError("vf and im must have the same length")
        return self


class EISData(BaseModel):
    freq:  list[float]
    zreal: list[float]
    zimag: list[float]
    zmod:  list[float]
    zphz:  list[float]

    @field_validator("freq", "zreal", "zimag", "zmod", "zphz")
    @classmethod
    def _check_len(cls, v: list[float]) -> list[float]:
        if len(v) > _MAX_PTS:
            raise ValueError(f"array exceeds {_MAX_PTS}-point limit")
        return v

    @model_validator(mode="after")
    def _check_matching_lengths(self) -> "EISData":
        n = len(self.freq)
        if not all(len(a) == n for a in [self.zreal, self.zimag, self.zmod, self.zphz]):
            raise ValueError("all EIS arrays must have the same length")
        return self


class CVRequest(BaseModel):
    curves:       list[Curve]
    scan_rate_mv: float = Field(10.0, gt=0)
    v_offset:     float = 0.0
    im_divisor:   float = 1.0
    prominence:   float = Field(0.05, ge=0, le=1)

    @field_validator("im_divisor")
    @classmethod
    def _nonzero_divisor(cls, v: float) -> float:
        if v == 0:
            raise ValueError("im_divisor must not be zero")
        return v
    detect_peaks: bool  = False
    v_lo:         float | None = None
    v_hi:         float | None = None

    @field_validator("curves")
    @classmethod
    def _check_curves(cls, v: list[Curve]) -> list[Curve]:
        if len(v) > _MAX_CURVES:
            raise ValueError(f"too many curves (max {_MAX_CURVES})")
        return v


class TafelRequest(BaseModel):
    curve:    Curve
    area_cm2: float = Field(1.0, gt=0)
    v_lo:     float | None = None
    v_hi:     float | None = None


class EISRequest(BaseModel):
    eis:   EISData
    model: Literal["auto", "randles", "randles_cpe", "randles_cpe_warburg"] = "auto"


class GCDRequest(BaseModel):
    cycles:          list[int]
    discharge_caps:  list[float]
    charge_by_cycle: dict[str, float]
    dis_energy_mwh:  dict[str, float] = {}
    ch_energy_mwh:   dict[str, float] = {}


class DunnEntry(BaseModel):
    vf:            list[float]
    im:            list[float]
    scan_rate_mv:  float = Field(..., gt=0)

    @field_validator("vf", "im")
    @classmethod
    def _check_len(cls, v: list[float]) -> list[float]:
        if len(v) > _MAX_PTS:
            raise ValueError(f"array exceeds {_MAX_PTS}-point limit")
        return v

    @model_validator(mode="after")
    def _check_matching_lengths(self) -> "DunnEntry":
        if len(self.vf) != len(self.im):
            raise ValueError("vf and im must have the same length")
        return self


class DunnRequest(BaseModel):
    entries:             list[DunnEntry]
    target_scan_rate_mv: float
    v_offset:            float = 0.0
    im_divisor:          float = 1.0
    n_points:            int   = 200

    @field_validator("entries")
    @classmethod
    def _check_entries(cls, v: list[DunnEntry]) -> list[DunnEntry]:
        if len(v) < 2:
            raise ValueError("at least 2 entries required")
        if len(v) > _MAX_CURVES:
            raise ValueError(f"too many entries (max {_MAX_CURVES})")
        return v


# ── Response models ───────────────────────────────────────────────────────────

class PeakSet(BaseModel):
    voltages:           list[float]
    currents:           list[float]
    currents_corrected: list[float]

class PeakResult(BaseModel):
    oxidation:   PeakSet
    reduction:   PeakSet
    delta_ep_mv: float | None
    peak_ratio:  float | None

class CVResult(BaseModel):
    capacitances_mf: list[float]
    areas:           list[float]
    peaks:           list[PeakResult] | None

class TafelFailResult(BaseModel):
    success: bool = False

class TafelOkResult(BaseModel):
    success:      bool = True
    slope_mv_dec: float
    slope_err_mv_dec: float
    j0_mA_cm2:   float
    r2:           float
    fit_v:        list[float]
    fit_log_j:    list[float]
    v_lo:         float
    v_hi:         float
    n_points:     int
    auto_window:  bool

class ComplexCap(BaseModel):
    freq:    list[float]
    c_prime: list[float]
    c_dbl:   list[float]

class CircuitFitResult(BaseModel):
    model:       str
    R_s:         float
    R_ct:        float
    C_dl_uF:     float | None = None
    Q:           float | None = None
    alpha:       float | None = None
    sigma:       float | None = None
    R_s_err:     float | None = None
    R_ct_err:    float | None = None
    C_dl_uF_err: float | None = None
    Q_err:       float | None = None
    alpha_err:   float | None = None
    sigma_err:   float | None = None
    rmse:        float
    aic:         float
    fit_zreal:   list[float]
    fit_zimag:   list[float]

class EISResult(BaseModel):
    esr:         float
    tau_ms:      float | None
    c_max_mf:    float
    complex_cap: ComplexCap
    circuit_fit: CircuitFitResult | None

class GCDResult(BaseModel):
    dis_mah:           list[float]
    ce_vals:           list[float | None]
    fade_pct:          float
    avg_ce:            float
    energy_efficiency: list[float | None]
    avg_energy_eff:    float | None


class DunnResult(BaseModel):
    cap_fraction:  float
    diff_fraction: float
    r2_mean:       float
    voltages:      list[float]
    i_total:       list[float]
    i_cap:         list[float]
    i_diff:        list[float]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _curve_df(c: Curve, v_offset: float = 0.0, im_divisor: float = 1.0) -> pd.DataFrame:
    return pd.DataFrame({
        "Vf": np.array(c.vf) + v_offset,
        "Im": np.array(c.im) / im_divisor,
    })


def _ser_peaks(peaks: dict) -> PeakResult:
    def _set(key: str) -> PeakSet:
        return PeakSet(
            voltages=peaks[key]["voltages"].tolist(),
            currents=peaks[key]["currents"].tolist(),
            currents_corrected=peaks[key]["currents_corrected"].tolist(),
        )
    return PeakResult(
        oxidation=_set("oxidation"),
        reduction=_set("reduction"),
        delta_ep_mv=peaks["delta_ep_mv"],
        peak_ratio=peaks["peak_ratio"],
    )


# ── CV / LSV ──────────────────────────────────────────────────────────────────

@router.post("/cv", response_model=CVResult)
@limiter.limit("60/minute")
def analyze_cv(request: Request, req: CVRequest) -> CVResult:
    dfs   = [_curve_df(c, req.v_offset, req.im_divisor) for c in req.curves]
    caps  = cv_capacitance(dfs, req.scan_rate_mv, req.v_lo, req.v_hi)
    areas = [float(compute_cv_area(df)) for df in dfs]
    peaks = [_ser_peaks(find_cv_peaks(df, req.prominence)) for df in dfs] if req.detect_peaks else None
    return CVResult(
        capacitances_mf=[c * 1000 for c in caps],
        areas=areas,
        peaks=peaks,
    )


# ── Dunn analysis ────────────────────────────────────────────────────────────

@router.post("/dunn", response_model=DunnResult)
@limiter.limit("30/minute")
def analyze_dunn(request: Request, req: DunnRequest) -> DunnResult:
    entries = [
        {"vf": e.vf, "im": e.im, "scan_rate_mv": e.scan_rate_mv}
        for e in req.entries
    ]
    result = compute_dunn_analysis(
        entries,
        target_scan_rate_mv=req.target_scan_rate_mv,
        v_offset=req.v_offset,
        im_divisor=req.im_divisor,
        n_points=req.n_points,
    )
    return DunnResult(**result)


# ── LSV Tafel ─────────────────────────────────────────────────────────────────

@router.post("/tafel")
@limiter.limit("60/minute")
def analyze_tafel(request: Request, req: TafelRequest) -> TafelOkResult | TafelFailResult:
    df   = _curve_df(req.curve)
    v_hi = float(df["Vf"].max()) if req.v_hi is None else req.v_hi
    v_span = abs(float(df["Vf"].min()) - float(df["Vf"].max()))
    v_lo = (v_hi - 0.60 * v_span) if req.v_lo is None else req.v_lo
    if req.v_hi is None:
        v_hi = float(df["Vf"].max()) - 0.17 * v_span

    res = tafel_analysis(df, req.area_cm2, v_lo, v_hi)
    if res is None:
        return TafelFailResult()
    return TafelOkResult(
        slope_mv_dec=res["slope_mv_dec"],
        slope_err_mv_dec=res["slope_err_mv_dec"],
        j0_mA_cm2=res["j0_mA_cm2"],
        r2=res["r2"],
        fit_v=res["fit_v"].tolist(),
        fit_log_j=res["fit_log_j"].tolist(),
        v_lo=float(v_lo),
        v_hi=float(v_hi),
        n_points=res["n_points"],
        auto_window=(req.v_lo is None and req.v_hi is None),
    )


# ── EIS ───────────────────────────────────────────────────────────────────────

@router.post("/eis", response_model=EISResult)
@limiter.limit("60/minute")
def analyze_eis(request: Request, req: EISRequest) -> EISResult:
    df = pd.DataFrame(req.eis.model_dump())
    df.rename(columns={"freq": "Freq", "zreal": "Zreal", "zimag": "Zimag",
                        "zmod": "Zmod", "zphz": "Zphz"}, inplace=True)
    esr     = float(eis_esr(df))
    cdf     = eis_complex_capacitance(df)
    tau     = eis_relaxation_time(cdf)
    c_max   = float(cdf["C_prime"].max()) * 1000  # mF
    fit     = eis_circuit_fit(df, model=req.model)

    return EISResult(
        esr=esr,
        tau_ms=(tau * 1000) if tau is not None else None,
        c_max_mf=c_max,
        complex_cap=ComplexCap(
            freq=cdf["Freq"].tolist(),
            c_prime=(cdf["C_prime"] * 1000).tolist(),
            c_dbl=(cdf["C_dbl"]   * 1000).tolist(),
        ),
        circuit_fit=_to_circuit_result(fit) if fit else None,
    )


def _to_circuit_result(fit: dict) -> CircuitFitResult:
    p   = fit["params"]
    e   = fit["errors"] or {}
    return CircuitFitResult(
        model=fit["model"],
        R_s=p["R_s"],
        R_ct=p["R_ct"],
        C_dl_uF=p["C_dl"] * 1e6 if "C_dl" in p else None,
        Q=p.get("Q"),
        alpha=p.get("alpha"),
        sigma=p.get("sigma"),
        R_s_err=e.get("R_s"),
        R_ct_err=e.get("R_ct"),
        C_dl_uF_err=e["C_dl"] * 1e6 if "C_dl" in e else None,
        Q_err=e.get("Q"),
        alpha_err=e.get("alpha"),
        sigma_err=e.get("sigma"),
        rmse=fit["rmse"],
        aic=fit["aic"],
        fit_zreal=fit["fit_zreal"],
        fit_zimag=fit["fit_zimag"],
    )


# ── GCD ───────────────────────────────────────────────────────────────────────

@router.post("/gcd", response_model=GCDResult)
@limiter.limit("60/minute")
def analyze_gcd(request: Request, req: GCDRequest) -> GCDResult:
    cbc     = {int(k): v for k, v in req.charge_by_cycle.items()}
    dis_mah = [c / 3600 * 1000 for c in req.discharge_caps]
    ce_vals: list[float | None] = [
        (dis_mah[i] / (cbc[c] / 3600 * 1000) * 100) if c in cbc else None
        for i, c in enumerate(req.cycles)
    ]

    first = dis_mah[0] if dis_mah else 0.0
    fade  = (first - dis_mah[-1]) / first * 100 if len(dis_mah) > 1 and first != 0.0 else 0.0

    valid_ce = [v for v in ce_vals if v is not None]
    avg_ce   = float(np.mean(valid_ce)) if valid_ce else 0.0

    # η = E_dis / E_ch × 100 per cycle, when both energies are available
    eff_vals: list[float | None] = [
        (req.dis_energy_mwh[str(c)] / req.ch_energy_mwh[str(c)] * 100)
        if str(c) in req.dis_energy_mwh and req.ch_energy_mwh.get(str(c), 0) > 0
        else None
        for c in req.cycles
    ]
    valid_eff = [v for v in eff_vals if v is not None]
    avg_eff   = round(float(np.mean(valid_eff)), 2) if valid_eff else None

    return GCDResult(
        dis_mah=dis_mah,
        ce_vals=ce_vals,
        fade_pct=round(fade, 2),
        avg_ce=round(avg_ce, 2),
        energy_efficiency=eff_vals,
        avg_energy_eff=avg_eff,
    )
