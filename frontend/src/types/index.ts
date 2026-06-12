export interface CurveData {
  vf: number[]
  im: number[]
}

export interface EISData {
  freq:  number[]
  zreal: number[]
  zimag: number[]
  zmod:  number[]
  zphz:  number[]
}

export interface GCDData {
  cycles:          number[]
  discharge_caps:  number[]
  charge_by_cycle: Record<string, number>
  durations?:      Record<string, { charge: number; discharge: number }>
  dis_energy_mwh?: Record<string, number>
  ch_energy_mwh?:  Record<string, number>
}

export type EType =
  | "CV"
  | "LSV"
  | "EISPOT"
  | "CHRONOP"
  | "PWR800_CYCLICCHARGEDISCHARGE"
  | "SEESAW"
  | null

export interface ParsedFile {
  id:    string
  name:  string
  etype: EType
  metadata?: Record<string, string>
  curves?: CurveData[]
  eis?:    EISData
  gcd?:    GCDData
  // SEESAW metadata only — data fetched on demand
  all_cycles?:   number[]
  total_cycles?: number
  // CV/LSV lazy files: curve count sent on upload; curves[] absent until fetched
  total_curves?: number
  // Set when large curve arrays were stripped to fit localStorage quota
  partial?: boolean
  // Set by backend when file format is unrecognised
  error?: string
  // Set when raw per-cycle waveform data was parsed on upload (CHRONOP/PWR800)
  total_gcd_cycles?: number
}

export interface PanelLayout {
  i: string
  x: number
  y: number
  w: number
  h: number
}

export interface FileSelection {
  fileId: string
  curveIndex: number  // 1-based cycle index (CV); ignored for EIS/GCD
}

export interface ComparisonSession {
  id: string
  name: string
  etype: EType
  selections: FileSelection[]
}

export interface AnalysisSession {
  id:     string
  name:   string
  fileId: string
}

// ── API request / response types ──────────────────────────────────────────────

export interface CVRequest {
  curves:        CurveData[]
  scan_rate_mv:  number
  v_offset?:     number
  im_divisor?:   number
  prominence?:   number
  detect_peaks?: boolean
  v_lo?:         number | null
  v_hi?:         number | null
}

export interface TafelRequest {
  curve:     CurveData
  area_cm2?: number
  v_lo?:     number | null
  v_hi?:     number | null
}

export interface GCDRequest {
  cycles:          number[]
  discharge_caps:  number[]
  charge_by_cycle: Record<string, number>
  dis_energy_mwh?: Record<string, number>
  ch_energy_mwh?:  Record<string, number>
}

export interface PeakSet {
  voltages:           number[]
  currents:           number[]
  currents_corrected: number[]
}

export interface PeakResult {
  oxidation:   PeakSet
  reduction:   PeakSet
  delta_ep_mv: number | null
  peak_ratio:  number | null
}

export interface CVResponse {
  capacitances_mf: number[]
  areas:           number[]
  peaks:           PeakResult[] | null
}

export type TafelResponse =
  | { success: false }
  | { success: true; slope_mv_dec: number; slope_err_mv_dec: number; j0_mA_cm2: number; r2: number;
      fit_v: number[]; fit_log_j: number[];
      v_lo: number; v_hi: number; n_points: number; auto_window: boolean }

export type CircuitModel = "auto" | "randles" | "randles_cpe" | "randles_cpe_warburg"

export interface CircuitFitResult {
  model:       string
  R_s:         number
  R_ct:        number
  C_dl_uF:     number | null
  Q:           number | null
  alpha:       number | null
  sigma:       number | null
  R_s_err:     number | null
  R_ct_err:    number | null
  C_dl_uF_err: number | null
  Q_err:       number | null
  alpha_err:   number | null
  sigma_err:   number | null
  rmse:        number
  aic:         number
  fit_zreal:   number[]
  fit_zimag:   number[]
}

export interface EISResponse {
  esr:      number
  tau_ms:   number | null
  c_max_mf: number
  complex_cap: {
    freq:    number[]
    c_prime: number[]
    c_dbl:   number[]
  }
  circuit_fit: CircuitFitResult | null
}

export interface GCDResponse {
  dis_mah:           number[]
  ce_vals:           (number | null)[]
  fade_pct:          number
  avg_ce:            number
  energy_efficiency: (number | null)[]
  avg_energy_eff:    number | null
}

export interface DunnEntry {
  vf:           number[]
  im:           number[]
  scan_rate_mv: number
}

export interface DunnRequest {
  entries:             DunnEntry[]
  target_scan_rate_mv: number
  v_offset?:           number
  im_divisor?:         number
  n_points?:           number
}

export interface DunnResponse {
  cap_fraction:  number
  diff_fraction: number
  r2_mean:       number
  voltages:      number[]
  i_total:       number[]
  i_cap:         number[]
  i_diff:        number[]
}
