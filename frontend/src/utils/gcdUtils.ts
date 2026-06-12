// Pure GCD calculation utilities — no React, no Plotly.

export function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export interface EsrResult {
  esr:      number | null;
  dV:       number | null;
  vChg:     number | null;
  vDis:     number | null;
  cycle:    number;
  warnings: string[];
}

/**
 * ESR from the voltage jump at the charge→discharge current reversal.
 * Uses ESR = ΔV / |ΔI|; skips 2 points on each side to avoid transients.
 */
export function computeGcdEsr(
  cycle: number,
  charge:    { times: number[]; voltages: number[]; currents: number[] },
  discharge: { times: number[]; voltages: number[]; currents: number[] },
): EsrResult {
  const warnings: string[] = [];
  if (charge.voltages.length < 6 || discharge.voltages.length < 6) {
    return { esr: null, dV: null, vChg: null, vDis: null, cycle,
             warnings: ["insufficient resolution at current reversal — ESR not computed"] };
  }
  const off  = 2;
  const vChg = charge.voltages[charge.voltages.length - 1 - off];
  const vDis = discharge.voltages[off];
  const iChg = median(charge.currents.slice(-5));
  const iDis = median(discharge.currents.slice(0, 5));
  const dI   = Math.abs(iChg - iDis);
  if (!(dI > 1e-9)) {
    return { esr: null, dV: null, vChg, vDis, cycle,
             warnings: ["current step undetermined — ESR not computed"] };
  }
  const dV = vChg - vDis;
  const tail  = charge.voltages.slice(-20);
  const diffs = tail.slice(1).map((v, i) => v - tail[i]);
  const noise = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / Math.max(diffs.length, 1));
  if (Math.abs(dV) < 2 * noise) warnings.push("IR drop near noise level — value unreliable");
  return { esr: dV / dI, dV, vChg, vDis, cycle, warnings };
}

/**
 * Local maxima of |dQ/dV| above a prominence threshold, deduplicated within
 * a 10-point neighbourhood.
 */
export function findDqdvPeaks(
  v: number[], dqdv: number[], thrFrac: number,
): { peaks: Array<{ v: number; y: number }>; warnings: string[] } {
  if (dqdv.length < 3) return { peaks: [], warnings: [] };
  const maxAbs = Math.max(...dqdv.map(Math.abs));
  if (maxAbs === 0) return { peaks: [], warnings: [] };
  const thr = thrFrac * maxAbs;
  const idxs: number[] = [];
  for (let i = 1; i < dqdv.length - 1; i++) {
    const a = Math.abs(dqdv[i]);
    if (a >= thr && a >= Math.abs(dqdv[i - 1]) && a > Math.abs(dqdv[i + 1])) {
      if (idxs.length && i - idxs[idxs.length - 1] < 10) {
        if (a > Math.abs(dqdv[idxs[idxs.length - 1]])) idxs[idxs.length - 1] = i;
      } else {
        idxs.push(i);
      }
    }
  }
  const warnings: string[] = [];
  const noise = dqdv.slice(1).reduce((s, y, i) => s + Math.abs(y - dqdv[i]), 0) / Math.max(dqdv.length - 1, 1);
  if (idxs.some(i => Math.abs(dqdv[i]) < 2 * noise)) warnings.push("one or more peaks near noise level");
  return { peaks: idxs.map(i => ({ v: v[i], y: dqdv[i] })), warnings };
}
