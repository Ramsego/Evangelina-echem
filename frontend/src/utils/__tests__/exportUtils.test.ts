import { describe, it, expect } from "vitest";
import { buildSummaryTxt, buildCombinedSummaryTxt, decimateRows, metaLines } from "../exportUtils";

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

  it("includes the LLM instructions at the end", () => {
    expect(result).toContain(prompt);
    expect(result.indexOf("LLM Instructions")).toBeLessThan(result.indexOf(prompt));
  });
});

describe("buildCombinedSummaryTxt", () => {
  const cvSummary = {
    etypeLabel: "CV",
    sections: [
      { title: "Computed values", lines: ["E_pa: 0.412 V"] },
      { title: "Empty section", lines: [] },
    ],
    llmInstructions: "per-file CV instructions",
  };
  const eisSummary = {
    etypeLabel: "EIS",
    sections: [{ title: "Computed values", lines: ["ESR: 1.2 Ohm"] }],
    llmInstructions: "per-file EIS instructions",
  };

  it("returns null for an empty entry list", () => {
    expect(buildCombinedSummaryTxt([])).toBeNull();
  });

  it("returns null when no entry has a summary", () => {
    expect(buildCombinedSummaryTxt([{ filename: "cmp" }])).toBeNull();
  });

  const result = buildCombinedSummaryTxt([
    { filename: "a", summary: cvSummary },
    { filename: "cmp" },
    { filename: "b", summary: eisSummary },
  ]) as string;

  it("includes app name and file/technique counts in the header", () => {
    expect(result).toContain("Files: 2");
    expect(result).toContain("Techniques: CV, EIS");
  });

  it("includes a block per summarized file, skipping summary-less entries", () => {
    expect(result).toContain("=== a — CV ===");
    expect(result).toContain("=== b — EIS ===");
    expect(result).not.toContain("cmp");
  });

  it("includes section content and skips empty sections", () => {
    expect(result).toContain("E_pa: 0.412 V");
    expect(result).toContain("ESR: 1.2 Ohm");
    expect(result).not.toContain("Empty section");
  });

  it("dedupes technique labels across multiple files of the same type", () => {
    const multi = buildCombinedSummaryTxt([
      { filename: "a", summary: cvSummary },
      { filename: "b", summary: cvSummary },
      { filename: "c", summary: eisSummary },
    ]) as string;
    expect(multi).toContain("Techniques: CV, EIS");
  });

  it("includes exactly one holistic instruction block naming the techniques, not the per-file ones", () => {
    const idx = result.indexOf("LLM Instructions");
    expect(idx).toBe(result.lastIndexOf("LLM Instructions"));
    expect(result).toContain("same material/system using different techniques (CV, EIS)");
    expect(result).not.toContain("per-file CV instructions");
    expect(result).not.toContain("per-file EIS instructions");
  });
});

describe("decimateRows", () => {
  it("returns all rows unchanged when under the cap", () => {
    const rows = ["a", "b", "c"];
    const { rows: out, note } = decimateRows(rows, 80);
    expect(out).toEqual(rows);
    expect(note).toContain("3 points");
  });

  it("evenly samples down to the cap and always keeps the first and last row", () => {
    const rows = Array.from({ length: 500 }, (_, i) => `row${i}`);
    const { rows: out } = decimateRows(rows, 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out[0]).toBe("row0");
    expect(out[out.length - 1]).toBe("row499");
  });
});

describe("metaLines", () => {
  it("returns an empty array for undefined or empty metadata", () => {
    expect(metaLines(undefined)).toEqual([]);
    expect(metaLines({})).toEqual([]);
  });

  it("maps known keys through META_LABELS", () => {
    const lines = metaLines({ TITLE: "My Experiment", OPERATOR: "J. Doe" });
    expect(lines).toContain("Title: My Experiment");
    expect(lines).toContain("Operator: J. Doe");
  });

  it("passes unknown keys through unchanged", () => {
    const lines = metaLines({ SOME_CUSTOM_FIELD: "value" });
    expect(lines).toContain("SOME_CUSTOM_FIELD: value");
  });

  it("filters out empty values", () => {
    const lines = metaLines({ TITLE: "Kept", NOTES: "" });
    expect(lines).toContain("Title: Kept");
    expect(lines.some(l => l.startsWith("Notes"))).toBe(false);
  });

  it("does not include a '#' comment prefix (unlike metaComments)", () => {
    const lines = metaLines({ TITLE: "My Experiment" });
    expect(lines[0]).not.toMatch(/^#/);
  });
});
