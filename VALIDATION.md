# Validation record

This document lists every analysis Evangelina performs, how its correctness is verified, and where that verification lives in the test suite. It exists so a viewer doesn't have to take the numbers on faith — the claim "this is right" is backed by a specific test with a specific tolerance, not just by the fact that the code runs.

Two kinds of evidence are used:
- **Analytical recovery** — synthetic input with a known closed-form answer; the test asserts the algorithm recovers it within a stated tolerance.
- **Invariance** — a property the math must obey regardless of scale, order, or offset (e.g. doubling all currents must exactly double a linear quantity). These catch classes of bugs a single example can miss.

Golden-number tests on the real bundled sample data are a third, weaker category: they don't prove correctness (there's no independent ground truth for real measured data), they only guard against **silent regressions** — the values were validated by eye in the running app once, then pinned.

| Analysis | Method | Verified against | Tolerance | Test |
|---|---|---|---|---|
| CV capacitance | C = ∫I dV / (2·ν·ΔV) | Scale invariance: doubling all currents doubles C | exact (±1e-9 rel) | `backend/tests/test_analysis.py::test_cv_capacitance_scales_linearly_with_current` |
| CV peak detection | scipy `find_peaks` on baseline-corrected half-sweeps | Sine-wave curve has a known ox > red peak ordering | qualitative | `backend/tests/test_analysis.py::test_cv_peaks_detected` |
| Tafel slope / j₀ | log₁₀\|j\| vs E, `scipy.stats.linregress` | Synthetic curve with exact 120 mV/dec slope | ±5 mV/dec | `backend/tests/test_analysis.py::test_tafel_known_slope` |
| Tafel slope, offset invariance | — | Shifting all potentials by +0.2 V leaves slope unchanged | ±0.5 mV/dec | `backend/tests/test_analysis.py::test_tafel_slope_invariant_to_potential_offset` |
| Dunn capacitive/diffusion separation | i(V,ν) = k1·ν + k2·√ν, per-V linear regression across scan rates | Synthetic pure-capacitive (k2=0) and pure-diffusion (k1=0) curves | cap_fraction ≥0.95 / ≤0.05, R²>0.99 | `backend/tests/test_dunn.py::test_dunn_pure_capacitive_recovers_full_cap_fraction`, `test_dunn_pure_diffusion_recovers_near_zero_cap_fraction`, `test_dunn_mixed_contribution_falls_strictly_between` |
| Dunn, order invariance | — | Shuffling entry order leaves result unchanged | ±1e-9 | `backend/tests/test_dunn.py::test_dunn_result_invariant_to_entry_order` |
| Dunn, scale invariance | — | Doubling current (via im_divisor) leaves cap_fraction unchanged | ±1e-6 | `backend/tests/test_dunn.py::test_dunn_cap_fraction_invariant_to_current_scale` |
| Dunn, bounds | — | cap_fraction/diff_fraction always in [0,1] over 15 random k1/k2 combinations | — | `backend/tests/test_dunn.py::test_dunn_cap_fraction_always_in_unit_bounds` |
| EIS ESR | Z′ at highest measured frequency | Analytic RC-circuit fixture | positive, matches circuit | `backend/tests/test_analysis.py::test_eis_esr_positive` |
| EIS Randles fit | `scipy.optimize.least_squares`, modulus-weighted | Exact Randles circuit (Rs=5Ω, Rct=50Ω) | recovers Rs/Rct | `backend/tests/test_analysis.py::test_eis_fit_randles_recovers_params` |
| EIS Randles-CPE fit | as above + constant-phase element | Exact CPE circuit (α=0.85) with 0.1% seeded noise | recovers α | `backend/tests/test_analysis.py::test_eis_fit_cpe_recovers_alpha` |
| EIS Randles-CPE-Warburg fit | as above + Warburg tail | Exact Warburg circuit (σ=20) with 0.1% seeded noise | recovers σ | `backend/tests/test_analysis.py::test_eis_fit_warburg_recovers_sigma` |
| EIS auto model selection | AICc (small-sample-corrected) across all three models | CPE-circuit data correctly selects the CPE model | — | `backend/tests/test_analysis.py::test_eis_fit_auto_selects_cpe_model` |
| EIS τ₀, C_max | τ₀ = 1/(2π·f₀) at peak C″ | derived from the same fit fixtures | — | `backend/gamry_plotter/analysis.py::eis_relaxation_time` (exercised via `test_eis_returns_expected_fields`) |
| GCD Coulombic efficiency | CE = Q_discharge / Q_charge from time-integrated current | Known Q_ch/Q_dis pair; ambiguous-segmentation and noisy-voltage edge cases | exact | `frontend/src/utils/__tests__/ceUtils.test.ts` |
| GCD ESR (IR drop) | ΔV/ΔI at the charge/discharge step | Known ΔV, ΔI pair | exact | `frontend/src/utils/__tests__/gcdUtils.test.ts::computeGcdEsr` |
| GCD dQ/dV peaks | box-car smoothed derivative + prominence-filtered peak finding | Synthetic single-peak and no-peak cases | qualitative | `frontend/src/utils/__tests__/gcdUtils.test.ts::findDqdvPeaks` |
| GCD capacity fade | discharge capacity per cycle | Synthetic stable (0% fade) and fading fixtures | exact | `backend/tests/test_analysis.py::test_gcd_stable_capacity_zero_fade`, `test_gcd_fading_capacity` |
| V–Q profile (A→mAh conversion) | Q = Σ\|I\|·dt, ×1000/3600 | Constant 1 A for 3600 s → exactly 1000 mAh; divisor scaling; monotonicity | exact | `frontend/src/utils/__tests__/plotUtils.test.ts::computeVQ` |
| dQ/dV (A→mAh conversion) | as above, per-point derivative | Constant current + linear voltage ramp → known constant dQ/dV | ±1e-6 | `frontend/src/utils/__tests__/plotUtils.test.ts::computeDQDVFromCurrents` |
| Reference-electrode offsets | E_RHE = E_SHE − 0.05916·pH; fixed offsets for SCE/Ag-AgCl/Hg-HgO/Hg₂SO₄ | Standard published potentials vs SHE; antisymmetry `refOffset(a,b) = -refOffset(b,a)` | exact | `frontend/src/utils/__tests__/referenceElectrodes.test.ts` |
| Area/mass normalisation divisor | mass entered in mg, capacity/capacitance conventions are per gram (÷1000) | Area passes through unchanged; mass divides by 1000, not by the raw mg value | exact | `frontend/src/utils/__tests__/normalization.test.ts` |
| CSV export | values written via Python's `csv` module, no transformation | Known row values round-trip exactly through `csv.reader` | exact | `backend/tests/test_export.py::test_csv_export_values_round_trip_exactly` |
| Real bundled sample data | full pipeline: parse → analyze | Regression pins on the actual CV/LSV/EIS/GCD sample files (validated by eye once) | see table below | `backend/tests/test_sample_golden.py` |

## Golden numbers for the bundled samples

| File | Metric | Pinned value | Tolerance |
|---|---|---|---|
| Sample_CV.dta | curve count / points / Vf range | 5 curves × 3200 pts, [0.2, 1.8] V | exact |
| Sample_LSV.dta | Tafel slope / R² | 121.4 mV/dec, R² > 0.99 | ±3 mV/dec |
| Sample_EIS.dta | ESR / fit model / R_s / R_ct | 1.49 Ω / Randles-CPE-Warburg / 1.41 Ω / 14.2 Ω | ±0.15 Ω / — / ±0.15 Ω / ±1.5 Ω |
| Sample_GCD.dta | cycle count / discharge_caps[0] | 95 cycles, 313.3 C/g | ±0.5 C/g |

## Known limitations (honesty section)

- **Sample_EIS.dta's frequency axis is reconstructed, not measured.** The source dataset (Zhang & Wei, USN, CC0 1.0, doi:10.18710/F4NFMJ) provides Z′/Z″ pairs without a frequency column. The frequency axis is a synthesized log-spaced sweep (100 kHz → 10 mHz, 60 points), which is standard for this kind of measurement but was not itself recorded. The Nyquist plot is fully real; anything reported per-frequency (Bode, τ₀) inherits this reconstruction.
- **Sample_GCD.dta's current channel is reconstructed.** The source CSV has time and voltage only. The current column is inferred from the sign of the smoothed voltage derivative (rising V → +0.1 A/g charging, falling V → −0.1 A/g discharging), which is a fair approximation for a galvanostatic (constant-current) experiment but is not the literal measured signal.
- **Sample_GCD.dta is a rate-performance step test, not a fade/cycle-life test.** Its 95 cycles come from a stepped current-density protocol (0.1 → 2 A/g and back), which is why the Cycle Life plot shows a dip-then-recovery shape rather than monotonic fade. The capacity values themselves are real, unaltered measurements — only the "Cycle Life" framing is a mismatch for this particular protocol.
- **Sample_LSV.dta is fully simulated** (Tafel + mass-transport model, j₀ = 1 mA/cm², b = 120 mV/dec). No openly-licensed LSV dataset was available at the time this was built.
- **No Coulombic efficiency for the GCD sample.** The source data doesn't include separate charge capacities, so CE cannot be computed for it.

## General disclaimer

Results should be independently verified before use in publications or other decisions where correctness matters. This validation record documents what has been checked and how — it is not a substitute for reviewing the underlying data and methods yourself.
