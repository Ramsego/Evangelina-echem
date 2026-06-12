// Shared Plotly layout base and axis override utility used by all panel types.

export const LAYOUT_BASE: Partial<Plotly.Layout> = {
  paper_bgcolor: "#111E16", plot_bgcolor: "#0D1C14",
  font:   { family: "Inter, system-ui", size: 11, color: "#74C69D" },
  margin: { l: 56, r: 16, t: 10, b: 48 },
  showlegend: true,
  legend: { bgcolor: "rgba(11,22,16,0.85)", borderwidth: 0, font: { color: "#A8D5BA", size: 11 }, tracegroupgap: 0, itemwidth: 20 },
  xaxis:  { gridcolor: "#1B4332", linecolor: "#2D6A4F", tickfont: { color: "#52B788" }, zeroline: false },
  yaxis:  { gridcolor: "#1B4332", linecolor: "#2D6A4F", tickfont: { color: "#52B788" }, zeroline: false },
};

export function axisOverride(min: string, max: string, isLog: boolean): Partial<Plotly.LayoutAxis> {
  const type = isLog ? "log" as const : "linear" as const;
  if (min === "" && max === "") return { type };
  const c = (v: string) => isLog && Number(v) > 0 ? Math.log10(Number(v)) : Number(v);
  const range: Plotly.Datum[] = [min !== "" ? c(min) : null, max !== "" ? c(max) : null];
  return { type, autorange: false as const, range };
}

export const shortName = (name: string) => name.replace(/\.dta$/i, "");

export function shortNames(names: string[]): string[] {
  if (names.length <= 1) return names.map(n => n.replace(/\.dta$/i, ""));
  const stripped = names.map(n => n.replace(/\.dta$/i, ""));
  let pLen = 0;
  while (pLen < stripped[0].length && stripped.every(n => n[pLen] === stripped[0][pLen])) pLen++;
  let sLen = 0;
  const maxSuffix = Math.min(...stripped.map(n => n.length)) - pLen;
  while (sLen < maxSuffix && stripped.every(n => n[n.length - 1 - sLen] === stripped[0][stripped[0].length - 1 - sLen])) sLen++;
  return stripped.map(n => {
    const s = n.slice(pLen, sLen ? -sLen : undefined).trim();
    return s || n;
  });
}

// Linear interpolation of ys at x, given sorted xs array.
// Returns 0 when x is outside the range of xs.
export function interpolateLinear(xs: number[], ys: number[], x: number): number {
  if (xs.length === 0) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

// Parse the raw SCANRATE string from a Gamry DTA header into a number.
// Gamry stores the value in the file's native unit (mV/s); returned as-is.
export function computeExtents(
  traces: Plotly.Data[]
): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const t of traces) {
    for (const v of ((t as Record<string, unknown>).x as number[] | undefined) ?? []) {
      if (typeof v === "number" && isFinite(v)) { if (v < xMin) xMin = v; if (v > xMax) xMax = v; }
    }
    for (const v of ((t as Record<string, unknown>).y as number[] | undefined) ?? []) {
      if (typeof v === "number" && isFinite(v)) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    }
  }
  if (!isFinite(xMin) || !isFinite(yMin)) return null;
  return { xMin, xMax, yMin, yMax };
}

export function parseScanRateMvs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw);
  if (isNaN(n) || n <= 0) return undefined;
  return n;
}

/**
 * Compute a dQ/dV curve from raw time, voltage, and current arrays.
 *
 * dQ = |Im| × dt   (mAh, using actual measured current)
 * dV = V(i+1) − V(i)
 * Points where |dV| < 0.5 mV or |dt| < 1 ms are skipped to avoid division noise.
 * A simple box-car moving average is applied for smoothing.
 */
export function computeDQDVFromCurrents(
  times:       number[],
  voltages:    number[],
  currents:    number[],   // Amperes
  smoothWindow: number,
): { v: number[]; dqdv: number[] } {
  const rawV:    number[] = [];
  const rawDQDV: number[] = [];

  for (let i = 0; i < times.length - 1; i++) {
    const dt = times[i + 1] - times[i];
    const dv = voltages[i + 1] - voltages[i];
    if (Math.abs(dt) < 0.001 || Math.abs(dv) < 0.0005) continue;
    const dq   = Math.abs(currents[i]) * 1000 * dt / 3600; // mAh
    rawV.push((voltages[i] + voltages[i + 1]) / 2);
    rawDQDV.push(dq / dv);
  }

  if (smoothWindow <= 1 || rawDQDV.length === 0) return { v: rawV, dqdv: rawDQDV };
  const half    = Math.floor(smoothWindow / 2);
  const smoothed = rawDQDV.map((_, idx) => {
    const lo = Math.max(0, idx - half);
    const hi = Math.min(rawDQDV.length - 1, idx + half);
    let sum = 0, count = 0;
    for (let j = lo; j <= hi; j++) { sum += rawDQDV[j]; count++; }
    return sum / count;
  });
  return { v: rawV, dqdv: smoothed };
}

/**
 * Convert raw V-t-I data into a V-Q galvanostatic profile.
 * Q is computed by integrating |Im| × dt (mAh).
 * Applies optional area/mass normalisation to Q.
 */
export function computeVQ(
  times:     number[],
  voltages:  number[],
  currents:  number[],   // Amperes
  divisor:   number = 1, // normVal for area/mass; 1 = no normalisation
): { q: number[]; v: number[] } {
  const q: number[] = [];
  let cumQ = 0;
  for (let i = 0; i < times.length; i++) {
    if (i > 0) {
      const dt = times[i] - times[i - 1];
      cumQ += Math.abs(currents[i]) * 1000 * dt / 3600; // mAh
    }
    q.push(cumQ / divisor);
    // voltages already in V
  }
  return { q, v: voltages };
}
