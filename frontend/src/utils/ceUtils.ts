// Pure CE (coulombic efficiency) calculation — no React, no Plotly.

export interface VQSegment {
  label: string;
  q: number[];
  v: number[];
}

export interface CeResult {
  ce: number | null;
  qCh: number | null;
  qDis: number | null;
  warnings: string[];
}

/**
 * Compute CE from a list of V-Q segments produced by splitVQByDirection.
 * Expects exactly one "Charge" segment and one "Discharge" segment.
 * CE = Q_discharge / Q_charge × 100.
 */
export function computeCE(segments: VQSegment[]): CeResult {
  const warnings: string[] = [];
  const chg = segments.filter(s => s.label === "Charge");
  const dis = segments.filter(s => s.label === "Discharge");

  if (segments.length !== 2 || chg.length !== 1 || dis.length !== 1) {
    return { ce: null, qCh: null, qDis: null,
             warnings: ["charge/discharge segmentation ambiguous — CE not computed"] };
  }

  if (chg[0].q.length < 5 || dis[0].q.length < 5) {
    warnings.push("too few points in half-cycle — CE unreliable");
  }

  const qCh  = chg[0].q[chg[0].q.length - 1];
  const qDis = dis[0].q[dis[0].q.length - 1];

  if (!(qCh > 0)) {
    return { ce: null, qCh, qDis, warnings: [...warnings, "zero charge capacity — CE not computed"] };
  }

  return { ce: qDis / qCh * 100, qCh, qDis, warnings };
}

export interface SeesawEsrResult {
  esr:      number | null;
  dV:       number | null;
  n:        number;
  warnings: string[];
}

/**
 * Estimate ESR from SEESAW V–Q segments at each charge→discharge boundary.
 * Skips 2 points on each side of the reversal (same transient-skip convention
 * as computeGcdEsr). ESR = |ΔV| / (2·I) because the current flips +I → −I.
 */
export function computeSeesawEsr(
  segments: VQSegment[],
  currentMA: number,
): SeesawEsrResult {
  const warnings: string[] = [];
  const I = currentMA / 1000; // A
  if (I <= 0) {
    return { esr: null, dV: null, n: 0, warnings: ["current must be > 0 — ESR not computed"] };
  }

  const esrVals: number[] = [];
  const dVVals:  number[] = [];

  for (let i = 0; i < segments.length - 1; i++) {
    const curr = segments[i];
    const next = segments[i + 1];
    // Only at a Charge → Discharge boundary
    if (curr.label !== "Charge" || next.label !== "Discharge") continue;
    if (curr.v.length < 6 || next.v.length < 6) {
      warnings.push(`segment pair ${i}/${i+1} too short — skipped`);
      continue;
    }
    const vChg = curr.v[curr.v.length - 3]; // 2 points before end
    const vDis = next.v[2];                  // 2 points after start
    const dV   = Math.abs(vChg - vDis);
    esrVals.push(dV / (2 * I));
    dVVals.push(dV);
  }

  if (esrVals.length === 0) {
    return { esr: null, dV: null, n: 0,
             warnings: [...warnings, "no valid charge→discharge boundary — ESR not computed"] };
  }

  const esr = esrVals.reduce((a, b) => a + b, 0) / esrVals.length;
  const dV  = dVVals.reduce((a, b) => a + b, 0)  / dVVals.length;
  return { esr, dV, n: esrVals.length, warnings };
}
