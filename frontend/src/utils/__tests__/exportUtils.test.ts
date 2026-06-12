import { describe, it, expect } from "vitest";
import { buildSummaryTxt } from "../exportUtils";

describe("buildSummaryTxt", () => {
  const sections = [
    { title: "Computed values", lines: ["E_pa: 0.412 V", "E_pc: 0.374 V"] },
    { title: "Warnings", lines: ["poor linear fit"] },
    { title: "Empty section", lines: [] },
  ];
  const prompt = "Help me interpret these CV results.";
  const result = buildSummaryTxt("sample.dta", "CV", sections, prompt);

  it("contains file name in header", () => {
    expect(result).toContain("sample.dta");
  });

  it("contains etype label in header", () => {
    expect(result).toContain("CV");
  });

  it("includes each non-empty section title", () => {
    expect(result).toContain("Computed values");
    expect(result).toContain("Warnings");
  });

  it("skips sections with no lines", () => {
    expect(result).not.toContain("Empty section");
  });

  it("includes section content lines", () => {
    expect(result).toContain("E_pa: 0.412 V");
    expect(result).toContain("poor linear fit");
  });

  it("includes the LLM prompt at the end", () => {
    expect(result).toContain(prompt);
    expect(result.indexOf("Suggested LLM prompt")).toBeLessThan(result.indexOf(prompt));
  });
});
