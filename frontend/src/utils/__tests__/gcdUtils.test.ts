import { describe, it, expect } from "vitest";
import { median, computeGcdEsr, findDqdvPeaks } from "../gcdUtils";

// ── median ────────────────────────────────────────────────────────────────────

describe("median", () => {
  it("returns middle value for odd-length array", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("returns upper-middle value for even-length array", () => {
    expect(median([4, 1, 3, 2])).toBe(3);
  });

  it("handles single element", () => {
    expect(median([42])).toBe(42);
  });
});

// ── computeGcdEsr ─────────────────────────────────────────────────────────────

function makeStep(v: number, i: number, n = 10) {
  return {
    times:    Array.from({ length: n }, (_, k) => k * 0.1),
    voltages: Array(n).fill(v),
    currents: Array(n).fill(i),
  };
}

describe("computeGcdEsr", () => {
  it("computes ESR from known ΔV and ΔI", () => {
    // charge ends at 4.0 V, discharge starts at 3.8 V → ΔV = 0.2 V
    // charge current +1 A, discharge current -1 A → ΔI = 2 A
    // ESR = 0.2 / 2 = 0.1 Ω
    const chg = makeStep(4.0, 1.0, 20);
    const dis = makeStep(3.8, -1.0, 20);
    // point at index 2 (after 2-point skip) is still 3.8
    const r = computeGcdEsr(1, chg, dis);
    expect(r.esr).toBeCloseTo(0.1, 3);
    expect(r.warnings).toHaveLength(0);
  });

  it("warns when fewer than 6 points available", () => {
    const chg = makeStep(4.0, 1.0, 4);
    const dis = makeStep(3.9, -1.0, 4);
    const r = computeGcdEsr(1, chg, dis);
    expect(r.esr).toBeNull();
    expect(r.warnings.some(w => w.includes("insufficient resolution"))).toBe(true);
  });

  it("warns when current step is near zero", () => {
    const chg = makeStep(4.0, 0.0, 10);
    const dis = makeStep(3.9, 0.0, 10);
    const r = computeGcdEsr(1, chg, dis);
    expect(r.esr).toBeNull();
    expect(r.warnings.some(w => w.includes("current step undetermined"))).toBe(true);
  });

  it("includes cycle number in result", () => {
    const chg = makeStep(4.0, 1.0, 10);
    const dis = makeStep(3.9, -1.0, 10);
    expect(computeGcdEsr(7, chg, dis).cycle).toBe(7);
  });
});

// ── findDqdvPeaks ─────────────────────────────────────────────────────────────

describe("findDqdvPeaks", () => {
  it("finds a single obvious peak", () => {
    const n = 50;
    const v    = Array.from({ length: n }, (_, i) => i * 0.01);
    const dqdv = Array(n).fill(0);
    dqdv[25] = 10.0; // clear maximum at index 25
    const { peaks } = findDqdvPeaks(v, dqdv, 0.1);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].v).toBeCloseTo(v[25], 5);
  });

  it("returns empty for arrays shorter than 3", () => {
    const { peaks, warnings } = findDqdvPeaks([0, 1], [0, 1], 0.1);
    expect(peaks).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("returns empty when all values are zero", () => {
    const v    = [0, 1, 2, 3, 4];
    const dqdv = [0, 0, 0, 0, 0];
    expect(findDqdvPeaks(v, dqdv, 0.1).peaks).toHaveLength(0);
  });

  it("filters peaks below prominence threshold", () => {
    const n = 50;
    const v    = Array.from({ length: n }, (_, i) => i * 0.01);
    const dqdv = Array(n).fill(0);
    dqdv[25] = 10.0;
    dqdv[10] = 0.5;  // below 20% threshold
    const { peaks } = findDqdvPeaks(v, dqdv, 0.2);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].v).toBeCloseTo(v[25], 5);
  });

  it("deduplicates peaks within 10-point neighbourhood", () => {
    const n = 50;
    const v    = Array.from({ length: n }, (_, i) => i * 0.01);
    const dqdv = Array(n).fill(0);
    dqdv[24] = 8.0;
    dqdv[25] = 10.0; // stronger neighbour — should win
    dqdv[26] = 7.0;
    const { peaks } = findDqdvPeaks(v, dqdv, 0.1);
    expect(peaks).toHaveLength(1);
    expect(peaks[0].v).toBeCloseTo(v[25], 5);
  });
});
