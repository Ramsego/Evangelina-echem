import { describe, it, expect } from "vitest";
import { computeVQ, computeDQDVFromCurrents } from "../plotUtils";

describe("computeVQ", () => {
  it("converts a constant 1 A applied for 3600 s into 1000 mAh", () => {
    const { q } = computeVQ([0, 3600], [0.2, 0.1], [1, 1]);
    expect(q[0]).toBe(0);
    expect(q[1]).toBeCloseTo(1000, 6);
  });

  it("halves cumulative Q when divisor is 2", () => {
    const { q } = computeVQ([0, 3600], [0.2, 0.1], [1, 1], 2);
    expect(q[1]).toBeCloseTo(500, 6);
  });

  it("produces a monotonically non-decreasing Q regardless of current sign", () => {
    const times    = [0, 10, 20, 30, 40];
    const currents = [0.5, -0.5, 0.5, -0.5, 0.5];
    const { q } = computeVQ(times, [0, 0, 0, 0, 0], currents);
    for (let i = 1; i < q.length; i++) {
      expect(q[i]).toBeGreaterThanOrEqual(q[i - 1]);
    }
  });

  it("handles a single-point array without crashing", () => {
    const { q, v } = computeVQ([0], [0.5], [1]);
    expect(q).toEqual([0]);
    expect(v).toEqual([0.5]);
  });

  it("handles an empty array without crashing", () => {
    const { q, v } = computeVQ([], [], []);
    expect(q).toEqual([]);
    expect(v).toEqual([]);
  });
});

describe("computeDQDVFromCurrents", () => {
  it("recovers a known constant dQ/dV from constant current and linear voltage ramp", () => {
    // dt = 1s, dv = 0.1V, I = 0.1A → dq = 0.1*1000*1/3600 mAh; dqdv = dq/0.1
    const times    = [0, 1, 2, 3, 4];
    const voltages = [0, 0.1, 0.2, 0.3, 0.4];
    const currents = [0.1, 0.1, 0.1, 0.1, 0.1];
    const expectedDqdv = (0.1 * 1000 * 1 / 3600) / 0.1;

    const { dqdv } = computeDQDVFromCurrents(times, voltages, currents, 1);
    expect(dqdv.length).toBeGreaterThan(0);
    for (const val of dqdv) {
      expect(val).toBeCloseTo(expectedDqdv, 6);
    }
  });

  it("skips points with near-zero dt or dv to avoid division noise", () => {
    const times    = [0, 0.0001, 1, 2];
    const voltages = [0, 0.00001, 0.1, 0.2];
    const currents = [0.1, 0.1, 0.1, 0.1];
    const { v, dqdv } = computeDQDVFromCurrents(times, voltages, currents, 1);
    expect(v.length).toBe(dqdv.length);
    expect(v.length).toBeLessThan(times.length);
  });

  it("returns empty arrays for too-short input", () => {
    const { v, dqdv } = computeDQDVFromCurrents([0], [0], [0], 1);
    expect(v).toEqual([]);
    expect(dqdv).toEqual([]);
  });
});
