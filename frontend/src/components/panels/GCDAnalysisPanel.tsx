import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ParsedFile, GCDResponse } from "../../types";
import { analyzeGCD } from "../../api/client";
import { metaLines, decimateRows, PanelSummary } from "../../utils/exportUtils";

interface Props {
  file:      ParsedFile;
  getCsvRef: React.MutableRefObject<() => string>;
  getSummaryRef: React.MutableRefObject<() => PanelSummary | undefined>;
}

const EXPLAIN: Record<string, string> = {
  dis:  "Discharge capacity (mAh) = discharge charge (C) ÷ 3600. Measures how much charge was extracted during the discharge step. A higher value means more energy delivered per cycle.",
  ce:   "Coulombic efficiency = (discharge capacity / charge capacity) × 100 %. Values below 100 % indicate charge lost to side reactions or leakage currents. High CE (> 99 %) is essential for long cycle life.",
  ret:  "Capacity retention = (discharge capacity at cycle N / discharge capacity at cycle 1) × 100 %. Tracks long-term fade; 80 % is a widely used end-of-life threshold.",
};

function fmt(v: number | null | undefined, dp = 2): string {
  return v != null && Number.isFinite(v) ? v.toFixed(dp) : "—";
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

export default function GCDAnalysisPanel({ file, getCsvRef, getSummaryRef }: Props) {
  const gcd = file.gcd;
  const [colExplain, setColExplain] = useState<string | null>(null);
  const toggle = (id: string) => setColExplain(prev => prev === id ? null : id);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["gcd-analysis", file.id],
    queryFn:  () => analyzeGCD({
      cycles:          gcd!.cycles,
      discharge_caps:  gcd!.discharge_caps,
      charge_by_cycle: gcd!.charge_by_cycle,
    }),
    enabled: !!gcd,
  });

  const disMah0 = (data as GCDResponse | undefined)?.dis_mah?.[0] ?? null;

  function buildCsv(): string {
    if (!data) return `# File: ${file.name}\n# Analysis: GCD\n# No data`;
    const d = data as GCDResponse;
    const lines = [
      `# File: ${file.name}`,
      `# Analysis: GCD`,
      `# Average CE: ${fmt(d.avg_ce, 2)} %  |  Capacity fade: ${fmt(d.fade_pct, 2)} %`,
      `Cycle,Discharge cap (mAh),CE (%),Capacity retention (%),Explanation`,
    ];
    d.dis_mah.forEach((dis, i) => {
      const ce  = d.ce_vals[i];
      const ret = disMah0 != null && disMah0 > 0 ? (dis / disMah0) * 100 : null;
      const exp = i === 0 ? `${EXPLAIN.dis} | ${EXPLAIN.ce} | ${EXPLAIN.ret}`.replace(/"/g, "'") : "";
      lines.push(`${gcd?.cycles[i] ?? i + 1},${fmt(dis, 4)},${fmt(ce, 2)},${fmt(ret, 2)},"${exp}"`);
    });
    lines.push(`Summary,Avg CE: ${fmt(d.avg_ce, 2)} %,Fade: ${fmt(d.fade_pct, 2)} %,,""`);
    return lines.join("\n");
  }
  getCsvRef.current = buildCsv;

  const cycles = gcd?.cycles ?? [];

  function buildSummary(): PanelSummary {
    const values = data
      ? [
          `Average CE: ${fmt((data as GCDResponse).avg_ce, 2)}%  [CE = Q_dis/Q_ch × 100]`,
          `Capacity fade: ${fmt((data as GCDResponse).fade_pct, 2)}%  [fade over ${cycles.length} cycles vs cycle 1]`,
        ]
      : ["(analysis not available)"];

    const dataRows = data
      ? (data as GCDResponse).dis_mah.map((dis, i) => {
          const ce  = (data as GCDResponse).ce_vals[i];
          const ret = disMah0 != null && disMah0 > 0 ? (dis / disMah0) * 100 : null;
          return `${cycles[i] ?? i + 1},${fmt(dis, 4)},${fmt(ce, 2)},${fmt(ret, 2)}`;
        })
      : [];
    const { rows: dataSample, note: dataNote } = decimateRows(dataRows);

    return {
      etypeLabel: "GCD analysis",
      sections: [
        { title: "Instrument metadata", lines: metaLines(file.metadata) },
        { title: "Computed values", lines: values },
        { title: "Warnings", lines: isError ? ["Analysis failed"] : ["(none)"] },
        { title: "Definitions", lines: [`Discharge capacity: ${EXPLAIN.dis}`, `CE: ${EXPLAIN.ce}`, `Retention: ${EXPLAIN.ret}`] },
        { title: `Data table (${dataNote})`, lines: ["Cycle,DisCap (mAh),CE (%),Retention (%)", ...dataSample] },
      ],
      llmInstructions: `Do not make assumptions about the experimental setup. First ask the user for any missing\ninformation that could materially affect interpretation of this galvanostatic\ncharge–discharge analysis (chemistry, electrode, current/C-rate, voltage window,\ntemperature, experimental objective). Once sufficient context has been provided, interpret\nthe values quantitatively, explain any uncertainty, list possible explanations for\nanomalies, and suggest follow-up experiments to distinguish between them.`,
    };
  }
  getSummaryRef.current = buildSummary;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="px-3 py-1.5 bg-panel-header border-b border-panel-border shrink-0">
        <span className="text-xs font-semibold text-panel-text">GCD Metrics</span>
      </div>

      <div className="flex-1 overflow-y-auto bg-panel-bg">
        {isLoading && <div className="p-4 text-sm text-panel-muted text-center">Analysing…</div>}
        {isError   && <div className="p-4 text-sm text-red-500  text-center">Analysis failed</div>}
        {!gcd      && <div className="p-4 text-sm text-panel-muted text-center">No GCD data</div>}

        {data && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-panel-header">
                    <th className={thCls}>Cycle</th>
                    <th className={thCls}>
                      Dis. cap (mAh)
                      <QBtn id="dis" active={colExplain === "dis"} onToggle={toggle} />
                    </th>
                    <th className={thCls}>
                      CE (%)
                      <QBtn id="ce" active={colExplain === "ce"} onToggle={toggle} />
                    </th>
                    <th className={thCls}>
                      Retention (%)
                      <QBtn id="ret" active={colExplain === "ret"} onToggle={toggle} />
                    </th>
                  </tr>
                  {colExplain && (
                    <tr className="bg-panel-hl">
                      <td colSpan={4} className="px-3 py-2 text-[11px] text-panel-muted leading-relaxed border-b border-panel-hlbdr">
                        {EXPLAIN[colExplain]}
                      </td>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {(data as GCDResponse).dis_mah.map((dis, i) => {
                    const ce  = (data as GCDResponse).ce_vals[i];
                    const ret = disMah0 != null && disMah0 > 0 ? (dis / disMah0) * 100 : null;
                    return (
                      <tr key={i} className={i % 2 === 0 ? "bg-panel-bg" : "bg-panel-bgalt"}>
                        <td className={tdCls}>{cycles[i] ?? i + 1}</td>
                        <td className={tdCls}>{fmt(dis, 3)}</td>
                        <td className={tdCls}>{fmt(ce, 2)}</td>
                        <td className={tdCls}>{fmt(ret, 1)}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-panel-hl font-semibold border-t border-panel-border">
                    <td className={tdCls + " text-panel-muted"}>Summary</td>
                    <td className={tdCls}>—</td>
                    <td className={tdCls}>Avg {fmt((data as GCDResponse).avg_ce, 2)}</td>
                    <td className={tdCls}>Fade {fmt((data as GCDResponse).fade_pct, 2)}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
