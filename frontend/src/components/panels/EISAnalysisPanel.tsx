import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ParsedFile, EISResponse } from "../../types";
import { analyzeEIS } from "../../api/client";
import { metaLines, PanelSummary } from "../../utils/exportUtils";

interface Props {
  file:      ParsedFile;
  getCsvRef: React.MutableRefObject<() => string>;
  getSummaryRef: React.MutableRefObject<() => PanelSummary | undefined>;
}

const EXPLAIN: Record<string, string> = {
  "ESR":           "Real part of the impedance Z′ at the highest measured frequency. Dominated by electrolyte and contact resistance — lower ESR means less ohmic loss and faster response.",
  "τ₀":            "Relaxation time τ₀ = 1/(2πf₀), where f₀ is the frequency at the peak of the imaginary capacitance C″(f). The characteristic timescale over which the device charges and discharges.",
  "C_max":         "Maximum real capacitance C′ = −Z″/(ω|Z|²), evaluated at its peak frequency. Extracted from the complex-capacitance formalism; represents the low-frequency accessible capacitance.",
  "Phase at 1 Hz": "Impedance phase angle at 1 Hz. An ideal capacitor gives −90°. Deviation towards 0° signals resistive or diffusive losses — the closer to −90°, the more purely capacitive the device behaves.",
  "f₀":            "Characteristic frequency f₀ = 1/(2πτ₀). Above f₀ the device dissipates more energy than it stores; a higher f₀ indicates a faster usable frequency range.",
};

function fmt(v: number | null | undefined, dp = 3): string {
  return v != null && Number.isFinite(v) ? v.toFixed(dp) : "—";
}

function nearestIndex(arr: number[], target: number): number {
  let best = 0, bestDist = Infinity;
  arr.forEach((v, i) => { const d = Math.abs(v - target); if (d < bestDist) { bestDist = d; best = i; } });
  return best;
}

const thCls = "px-2 py-1 text-left text-[10px] font-semibold text-panel-muted uppercase tracking-wider border-b border-panel-border whitespace-nowrap";
const tdCls = "px-2 py-1 text-[11px] text-panel-text tabular-nums";

function QBtn({ id, active, onToggle }: { id: string; active: boolean; onToggle: (id: string) => void }) {
  return (
    <button
      onClick={() => onToggle(id)}
      className={`ml-1 text-[9px] border rounded-full w-3.5 h-3.5 inline-flex items-center justify-center leading-none transition-colors cursor-pointer shrink-0 ${active ? "border-forest-400 text-forest-600 bg-panel-hl" : "border-panel-border text-panel-muted hover:text-forest-600 hover:border-forest-400"}`}
    >?</button>
  );
}

export default function EISAnalysisPanel({ file, getCsvRef, getSummaryRef }: Props) {
  const eis = file.eis;
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const toggle = (id: string) => setActiveRow(prev => prev === id ? null : id);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["eis-analysis", file.id],
    queryFn:  () => analyzeEIS({ eis: eis! }), // eis is defined when enabled
    enabled:  !!eis,
  });

  const phaseAt1Hz = eis ? eis.zphz[nearestIndex(eis.freq, 1)] : null;
  const f0 = data?.tau_ms != null ? 1000 / (2 * Math.PI * data.tau_ms) : null;

  const rows: { label: string; value: string; unit: string }[] = data
    ? [
        { label: "ESR",           value: fmt(data.esr, 3),      unit: "Ω"  },
        { label: "τ₀",            value: fmt(data.tau_ms, 2),   unit: "ms" },
        { label: "C_max",         value: fmt(data.c_max_mf, 3), unit: "mF" },
        { label: "Phase at 1 Hz", value: fmt(phaseAt1Hz, 2),    unit: "°"  },
        { label: "f₀",            value: fmt(f0, 3),            unit: "Hz" },
      ]
    : [];

  function buildCsv(): string {
    if (!data) return `# File: ${file.name}\n# Analysis: EIS\n# No data`;
    return [
      `# File: ${file.name}`,
      `# Analysis: EIS`,
      `Metric,Value,Unit,Explanation`,
      `ESR,${fmt(data.esr, 4)},Ω,"${EXPLAIN["ESR"].replace(/"/g, "'")}"`,
      `τ₀,${fmt(data.tau_ms, 4)},ms,"${EXPLAIN["τ₀"].replace(/"/g, "'")}"`,
      `C_max,${fmt(data.c_max_mf, 4)},mF,"${EXPLAIN["C_max"].replace(/"/g, "'")}"`,
      `Phase at 1 Hz,${fmt(phaseAt1Hz, 4)},°,"${EXPLAIN["Phase at 1 Hz"].replace(/"/g, "'")}"`,
      `f₀,${fmt(f0, 4)},Hz,"${EXPLAIN["f₀"].replace(/"/g, "'")}"`,
    ].join("\n");
  }
  getCsvRef.current = buildCsv;

  function buildSummary(): PanelSummary {
    const values = data
      ? [
          `ESR: ${fmt(data.esr, 3)} Ω  [Z′ at highest measured frequency]`,
          `τ₀: ${fmt(data.tau_ms, 2)} ms  [τ₀ = 1/(2πf₀), f₀ at peak of C″(f)]`,
          `C_max: ${fmt(data.c_max_mf, 3)} mF  [C′ = −Z″/(ω|Z|²) at its peak]`,
          `Phase at 1 Hz: ${fmt(phaseAt1Hz, 2)}°`,
          `f₀: ${fmt(f0, 3)} Hz  [f₀ = 1/(2πτ₀)]`,
        ]
      : ["(analysis not available)"];

    return {
      etypeLabel: "EIS analysis",
      sections: [
        { title: "Instrument metadata", lines: metaLines(file.metadata) },
        { title: "Computed values", lines: values },
        { title: "Warnings", lines: isError ? ["Analysis failed"] : ["(none)"] },
        { title: "Definitions", lines: Object.entries(EXPLAIN).map(([k, v]) => `${k}: ${v}`) },
      ],
      llmInstructions: `Do not make assumptions about the experimental setup. First ask the user for any missing\ninformation that could materially affect interpretation of this impedance spectroscopy\nanalysis (working electrode, electrolyte, reference electrode, counter electrode, DC bias,\nAC amplitude, temperature, experimental objective). Once sufficient context has been\nprovided, interpret the values quantitatively, explain any uncertainty, list possible\nexplanations for anomalies, and suggest follow-up experiments to distinguish between them.`,
    };
  }
  getSummaryRef.current = buildSummary;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="px-3 py-1.5 bg-panel-header border-b border-panel-border shrink-0">
        <span className="text-xs font-semibold text-panel-text">EIS Metrics</span>
      </div>

      <div className="flex-1 overflow-y-auto bg-panel-bg">
        {isLoading && <div className="p-4 text-sm text-panel-muted text-center">Analysing…</div>}
        {isError   && <div className="p-4 text-sm text-red-500  text-center">Analysis failed</div>}
        {!eis      && <div className="p-4 text-sm text-panel-muted text-center">No EIS data</div>}

        {data && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-panel-header">
                  <th className={thCls}>Metric</th>
                  <th className={thCls}>Value</th>
                  <th className={thCls}>Unit</th>
                  <th className={thCls + " w-6"}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <>
                    <tr key={r.label} className={i % 2 === 0 ? "bg-panel-bg" : "bg-panel-bgalt"}>
                      <td className={tdCls + " font-medium text-panel-muted"}>{r.label}</td>
                      <td className={tdCls}>{r.value}</td>
                      <td className={tdCls + " text-panel-muted"}>{r.unit}</td>
                      <td className="px-1 py-1 text-right">
                        <QBtn id={r.label} active={activeRow === r.label} onToggle={toggle} />
                      </td>
                    </tr>
                    {activeRow === r.label && (
                      <tr key={`${r.label}-explain`} className="bg-panel-hl">
                        <td colSpan={4} className="px-3 py-2 text-[11px] text-panel-muted leading-relaxed border-b border-panel-hlbdr">
                          {EXPLAIN[r.label]}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
