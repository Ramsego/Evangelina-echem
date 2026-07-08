// Shared area/mass normalisation divisor used by CV and GCD panels.
// Mass is entered in mg but capacitance/capacity conventions are per gram,
// hence the /1000 — get this wrong and every "per gram" number is 1000x off.
export function normDivisor(norm: "none" | "area" | "mass", normVal: number): number {
  return norm === "area" ? normVal : norm === "mass" ? normVal / 1000 : 1.0;
}
