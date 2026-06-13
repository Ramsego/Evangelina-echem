import { describe, it, expect } from "vitest";
import { computeCE, VQSegment } from "../ceUtils";

function seg(label: string, qMax: number, n = 10): VQSegment {
  const q = Array.from({ length: n }, (_, i) => (qMax * (i + 1)) / n);
  return { label, q, v: Array(n).fill(3.5) };
}

describe("computeCE", () => {
  it("computes CE from known Q_ch and Q_dis", () => {
    const segments = [seg("Charge", 1.0), seg("Discharge", 0.95)];
    const r = computeCE(segments);
    expect(r.ce).toBeCloseTo(95.0, 3);
    expect(r.qCh).toBeCloseTo(1.0, 5);
    expect(r.qDis).toBeCloseTo(0.95, 5);
    expect(r.warnings).toHaveLength(0);
  });

  it("returns null CE when segmentation is ambiguous (≠ 2 segments)", () => {
    const r = computeCE([seg("Charge", 1.0), seg("Discharge", 0.9), seg("Charge", 1.0)]);
    expect(r.ce).toBeNull();
    expect(r.warnings.some(w => w.includes("ambiguous"))).toBe(true);
  });

  it("returns null CE when both segments are the same direction", () => {
    const r = computeCE([seg("Charge", 1.0), seg("Charge", 0.9)]);
    expect(r.ce).toBeNull();
    expect(r.warnings.some(w => w.includes("ambiguous"))).toBe(true);
  });

  it("warns when half-cycle has fewer than 5 points", () => {
    const r = computeCE([seg("Charge", 1.0, 3), seg("Discharge", 0.9, 3)]);
    expect(r.warnings.some(w => w.includes("too few points"))).toBe(true);
  });

  it("returns null CE when charge capacity is zero", () => {
    const r = computeCE([seg("Charge", 0.0), seg("Discharge", 0.9)]);
    expect(r.ce).toBeNull();
    expect(r.warnings.some(w => w.includes("zero charge capacity"))).toBe(true);
  });

  it("returns empty array for empty segments", () => {
    const r = computeCE([]);
    expect(r.ce).toBeNull();
  });

  it("computes CE from noisy non-monotonic voltage when labels are authoritative", () => {
    // Regression: the old voltage-direction splitter produced ≠2 segments for
    // wandering voltage. With server-supplied labels, CE depends only on Q.
    const noisyV = [3.50, 3.49, 3.52, 3.48, 3.55, 3.50, 3.58, 3.54, 3.60, 3.57];
    const q = Array.from({ length: 10 }, (_, i) => (i + 1) / 10);
    const charge:    VQSegment = { label: "Charge",    q, v: noisyV };
    const discharge: VQSegment = { label: "Discharge", q: q.map(x => x * 0.95), v: [...noisyV].reverse() };
    const r = computeCE([charge, discharge]);
    expect(r.ce).toBeCloseTo(95.0, 3);
    expect(r.warnings.some(w => w.includes("ambiguous"))).toBe(false);
  });
});
