import { describe, it, expect } from "vitest";
import { electrodeVsSHE, refOffset, xAxisLabel, ELECTRODES } from "../referenceElectrodes";

describe("ELECTRODES table", () => {
  it("matches the standard potentials vs SHE (V) at 25 °C", () => {
    expect(ELECTRODES["SCE (sat. KCl)"]).toBe(0.241);
    expect(ELECTRODES["Ag/AgCl (3M KCl)"]).toBe(0.209);
    expect(ELECTRODES["Ag/AgCl (sat. KCl)"]).toBe(0.197);
    expect(ELECTRODES["Hg/HgO (1M NaOH)"]).toBe(0.098);
    expect(ELECTRODES["Hg/Hg₂SO₄ (sat.)"]).toBe(0.615);
    expect(ELECTRODES["As measured"]).toBe(0);
    expect(ELECTRODES["NHE / SHE"]).toBe(0);
  });
});

describe("electrodeVsSHE", () => {
  it("returns the table value for a fixed electrode", () => {
    expect(electrodeVsSHE("SCE (sat. KCl)")).toBe(0.241);
  });

  it("returns 0 for an unknown electrode", () => {
    expect(electrodeVsSHE("nonsense")).toBe(0);
  });

  it("computes RHE as 0.05916 * pH", () => {
    expect(electrodeVsSHE("RHE", 7)).toBeCloseTo(0.05916 * 7, 10);
    expect(electrodeVsSHE("RHE", 0)).toBe(0);
    expect(electrodeVsSHE("RHE", 14)).toBeCloseTo(0.05916 * 14, 10);
  });
});

describe("refOffset", () => {
  it("is zero for identical from/to electrodes", () => {
    expect(refOffset("SCE (sat. KCl)", "SCE (sat. KCl)")).toBe(0);
  });

  it("is antisymmetric: refOffset(a,b) === -refOffset(b,a)", () => {
    const ab = refOffset("SCE (sat. KCl)", "Ag/AgCl (3M KCl)");
    const ba = refOffset("Ag/AgCl (3M KCl)", "SCE (sat. KCl)");
    expect(ab).toBeCloseTo(-ba, 10);
  });

  it("computes the known offset between SCE and Hg/HgO", () => {
    // 0.241 - 0.098 = 0.143 V
    expect(refOffset("SCE (sat. KCl)", "Hg/HgO (1M NaOH)")).toBeCloseTo(0.143, 10);
  });

  it("respects pH for RHE-involving conversions", () => {
    const at7  = refOffset("NHE / SHE", "RHE", 7);
    const at14 = refOffset("NHE / SHE", "RHE", 14);
    expect(at7).toBeCloseTo(-0.05916 * 7, 10);
    expect(at14).toBeCloseTo(-0.05916 * 14, 10);
    expect(at14).not.toBeCloseTo(at7, 3);
  });
});

describe("xAxisLabel", () => {
  it("returns a plain label for 'As measured'", () => {
    expect(xAxisLabel("As measured")).toBe("Potential (V)");
  });

  it("returns an 'E vs X (V)' label with the short electrode name", () => {
    expect(xAxisLabel("SCE (sat. KCl)")).toBe("E vs SCE (V)");
    expect(xAxisLabel("RHE")).toBe("E vs RHE (V)");
  });

  it("falls back to the raw string for an unmapped electrode", () => {
    expect(xAxisLabel("Custom Ref")).toBe("E vs Custom Ref (V)");
  });
});
