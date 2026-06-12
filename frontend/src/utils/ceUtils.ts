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
