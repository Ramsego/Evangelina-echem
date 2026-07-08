import { describe, it, expect } from "vitest";
import { normDivisor } from "../normalization";

describe("normDivisor", () => {
  it("returns 1 for no normalisation", () => {
    expect(normDivisor("none", 5)).toBe(1.0);
  });

  it("passes the area value through unchanged (mA/cm²)", () => {
    expect(normDivisor("area", 0.5)).toBe(0.5);
  });

  it("divides mass by 1000 to convert mg to g (mA/g)", () => {
    expect(normDivisor("mass", 10)).toBeCloseTo(0.01, 10);
  });

  it("ignores normVal when norm is none", () => {
    expect(normDivisor("none", 999)).toBe(1.0);
  });
});
