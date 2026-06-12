// Standard potentials vs SHE (V) at 25 °C
export const ELECTRODES: Record<string, number> = {
  "As measured":           0,
  "NHE / SHE":            0,
  "SCE (sat. KCl)":       0.241,
  "Ag/AgCl (3M KCl)":    0.209,
  "Ag/AgCl (sat. KCl)":  0.197,
  "Hg/HgO (1M NaOH)":    0.098,
  "Hg/Hg₂SO₄ (sat.)":    0.615,
};

// Dropdown options — RHE appended separately because its value is pH-dependent
export const ELECTRODE_OPTIONS = [...Object.keys(ELECTRODES), "RHE"];

// Potential of the given electrode vs SHE (V). RHE: E_RHE = E_SHE − 0.0592·pH
export function electrodeVsSHE(electrode: string, pH = 7): number {
  if (electrode === "RHE") return 0.05916 * pH;
  return ELECTRODES[electrode] ?? 0;
}

// Net offset to add to measured data: converts "from" scale → "to" scale
export function refOffset(from: string, to: string, pH = 7): number {
  return electrodeVsSHE(from, pH) - electrodeVsSHE(to, pH);
}

// Short display names for axis labels
const SHORT: Record<string, string> = {
  "NHE / SHE":           "NHE",
  "SCE (sat. KCl)":      "SCE",
  "Ag/AgCl (3M KCl)":   "Ag/AgCl",
  "Ag/AgCl (sat. KCl)": "Ag/AgCl (sat.)",
  "Hg/HgO (1M NaOH)":   "Hg/HgO",
  "Hg/Hg₂SO₄ (sat.)":   "Hg/Hg₂SO₄",
  "RHE":                 "RHE",
};

export function xAxisLabel(to: string): string {
  if (to === "As measured") return "Potential (V)";
  return `E vs ${SHORT[to] ?? to} (V)`;
}
