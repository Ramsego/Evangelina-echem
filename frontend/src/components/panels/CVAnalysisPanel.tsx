import { useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ParsedFile, PeakResult } from "../../types";
import { analyzeCV } from "../../api/client";
import { parseScanRateMvs } from "../../utils/plotUtils";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { refOffset } from "../../utils/referenceElectrodes";
import { metaLines, PanelSummary } from "../../utils/exportUtils";
import ScanRateAnalysis, { SrPlotExport } from "./ScanRateAnalysis";
import DunnAnalysis, { DunnPlotExport } from "./DunnAnalysis";

export interface CVAnalysisPlots {
  dunn: DunnPlotExport | null;
  sr:   SrPlotExport[];
}

export interface MetricRow {
  section:     string;
  metric:      string;
  cycle:       string;
  value:       string;
  unit:        string;
  explanation: string;
}

interface Props {
  file:           ParsedFile;
  files:          ParsedFile[];
  getCsvRef:      React.MutableRefObject<() => string>;
  getPlotRef:     React.MutableRefObject<() => CVAnalysisPlots>;
  getMetricRowsRef: React.MutableRefObject<() => MetricRow[]>;
  getSummaryRef:  React.MutableRefObject<() => PanelSummary | undefined>;
}

const EXPLAIN: Record<string, string> = {
  c:     "C = ∫I dV / (2·ΔV·ν), where ΔV is the potential window and ν is the scan rate. Half-cell (3-electrode): reports single-electrode capacitance directly. Full-cell (2-electrode symmetric): raw formula gives cell capacitance; values are multiplied ×2 to recover per-electrode capacitance, because two electrodes in series halve the measured cell value relative to a single electrode.",
  area:  "Loop area = ∫I dV (mA·V). The raw enclosed area of the CV curve, directly proportional to total charge passed per cycle. Larger area = more charge stored or consumed.",
  eox:   "Potential at the maximum anodic current in the positive-scan direction. This is where the oxidation reaction is most thermodynamically favoured.",
  ered:  "Potential at the minimum cathodic current in the negative-scan direction. This is where the reduction reaction is most thermodynamically favoured.",
  dep:   "Peak separation ΔEp = E_ox − E_red. For a fully reversible one-electron couple at 25 °C, ΔEp ≈ 59 mV. Larger values indicate quasi-reversibility or slow electron transfer kinetics.",
  ehalf: "Formal potential E½ = (E_ox + E_red) / 2. For a reversible couple this approximates the standard redox potential E°.",
  ratio: "Peak current ratio |ip_c / ip_a|: cathodic peak current divided by anodic. Equal to 1 for a fully reversible couple. Deviates when oxidised or reduced products diffuse away or are consumed by a coupled chemical reaction.",
};

function mean(arr: number[]) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN; }
function std(arr: number[]) {
  if (arr.length < 2) return NaN;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}
function fmt(v: number | null | undefined, dp = 3): string {
  return v != null && Number.isFinite(v) ? v.toFixed(dp) : "—";
}

const thCls = "px-2 py-1 text-left text-[10px] font-semibold text-panel-muted uppercase tracking-wider border-b border-panel-border whitespace-nowrap";
const tdCls = "px-2 py-1 text-[11px] text-panel-text tabular-nums";

function QBtn({ id, active, onToggle }: { id: string; active: boolean; onToggle: (id: string) => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(id); }}
      className={`ml-1 text-[9px] border rounded-full w-3.5 h-3.5 inline-flex items-center justify-center leading-none transition-colors cursor-pointer shrink-0 ${active ? "border-forest-400 text-forest-600 bg-panel-hl" : "border-panel-border text-panel-muted hover:text-forest-600 hover:border-forest-400"}`}
    >?</button>
  );
}

function ExplainRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr className="bg-panel-hl">
      <td colSpan={cols} className="px-3 py-2 text-[11px] text-panel-muted leading-relaxed border-b border-panel-hlbdr">
        {text}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CVAnalysisPanel({ file, files, getCsvRef, getPlotRef, getMetricRowsRef, getSummaryRef }: Props) {
  const curves       = file.curves ?? [];
  const total        = curves.length;
  const detectedRate = parseScanRateMvs(file.metadata?.SCANRATE);
  const [manualRate, setManualRate] = useLocalStorage(`${file.id}.scanRate`, 10);
  const scanRate = detectedRate ?? manualRate;

  // Shared with CVPanel (same localStorage keys) so both panels report
  // identical numbers for the same settings.
  const [prom]     = useLocalStorage(`${file.id}.peakProm`, 5);
  const [refFrom]  = useLocalStorage(`${file.id}.refFrom`, "As measured");
  const [refTo]    = useLocalStorage(`${file.id}.refTo`,   "As measured");
  const [pH]       = useLocalStorage(`${file.id}.pH`,      7.0);
  const [norm]     = useLocalStorage<"none"|"area"|"mass">(`${file.id}.norm`, "none");
  const [normVal]  = useLocalStorage(`${file.id}.normVal`, 1.0);
  const vOffset   = refOffset(refFrom, refTo, pH);
  const imDivisor = norm === "area" ? normVal : norm === "mass" ? normVal / 1000 : 1.0;

  // Cycle range — 1-based, inclusive
  const [lo, setLo] = useState(1);
  const [hi, setHi] = useState(Math.max(1, total));

  const safeHi = Math.min(hi, total);
  const safeLo = Math.max(1, Math.min(lo, safeHi));
  const selectedCurves  = curves.slice(safeLo - 1, safeHi);
  const selectedIndices = Array.from({ length: safeHi - safeLo + 1 }, (_, i) => safeLo - 1 + i);

  // Section open/close state
  const [capOpen,   setCapOpen]   = useState(true);
  const [peaksOpen, setPeaksOpen] = useState(true);
  const [srOpen,    setSrOpen]    = useState(false);
  const [dunnOpen,  setDunnOpen]  = useState(false);
  const [cellConfig, setCellConfig] = useLocalStorage<"half" | "full_symmetric">(`${file.id}.cellConfig`, "half");

  // Per-column ? state — one active explanation per table at a time
  const [capExplain,  setCapExplain]  = useState<string | null>(null);
  const [peakExplain, setPeakExplain] = useState<string | null>(null);

  const allCvFiles = useMemo(() =>
    files.filter(f => (f.etype === "CV" || f.etype === "LSV") && (f.curves?.length ?? 0) > 0),
    [files],
  );

  const getSrCsvRef    = useRef<() => string>(() => "");
  const getDunnCsvRef  = useRef<() => string>(() => "");
  const getDunnPlotRef = useRef<() => DunnPlotExport | null>(() => null);
  const getSrPlotsRef  = useRef<() => SrPlotExport[]>(() => []);
  const getSrSummaryRef   = useRef<() => string[]>(() => []);
  const getDunnSummaryRef = useRef<() => string[]>(() => []);

  getPlotRef.current = () => ({
    dunn: getDunnPlotRef.current(),
    sr:   getSrPlotsRef.current(),
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["cv-analysis", file.id, scanRate, safeLo, safeHi, prom, vOffset, imDivisor],
    queryFn:  () => analyzeCV({
      curves:       selectedCurves,
      scan_rate_mv: scanRate,
      v_offset:     vOffset,
      im_divisor:   imDivisor,
      detect_peaks: true,
      prominence:   prom / 100,
    }),
    enabled: selectedCurves.length > 0,
  });

  // ── Metric rows (structured) — the always-available capacitance/area/peaks
  // table, independent of the SR/Dunn accordion state. Shared by CSV, the table
  // image, and the XLSX export so all three agree.
  function buildMetricRows(): MetricRow[] {
    const rows: MetricRow[] = [];
    displayCaps.forEach((c, i) => {
      rows.push({ section: "Capacitance & Area", metric: "C", cycle: String(selectedIndices[i] + 1), value: c.toFixed(4), unit: "mF", explanation: i === 0 ? EXPLAIN.c : "" });
    });
    areas.forEach((a, i) => {
      rows.push({ section: "Capacitance & Area", metric: "Area", cycle: String(selectedIndices[i] + 1), value: a.toFixed(4), unit: "mA·V", explanation: i === 0 ? EXPLAIN.area : "" });
    });
    if (displayCaps.length >= 2) {
      rows.push({ section: "Capacitance & Area", metric: "C (mean ± std)", cycle: "—", value: `${mean(displayCaps).toFixed(4)} ± ${std(displayCaps).toFixed(4)}`, unit: "mF", explanation: "" });
      rows.push({ section: "Capacitance & Area", metric: "Area (mean ± std)", cycle: "—", value: `${mean(areas).toFixed(4)} ± ${std(areas).toFixed(4)}`, unit: "mA·V", explanation: "" });
    }
    peaks.forEach((pk, i) => {
      const eOx = pk.oxidation.voltages[0];
      const eRed = pk.reduction.voltages[0];
      const ipA  = pk.oxidation.currents[0];
      const ipC  = pk.reduction.currents[0];
      const dEp  = eOx != null && eRed != null ? (eOx - eRed) * 1000 : null;
      const eH   = eOx != null && eRed != null ? (eOx + eRed) / 2 : null;
      const rat  = ipA != null && ipC != null && ipA !== 0 ? Math.abs(ipC / ipA) : null;
      const cyc  = String(selectedIndices[i] + 1);
      rows.push({ section: "Peaks", metric: "E_ox",      cycle: cyc, value: fmt(eOx, 4), unit: "V",  explanation: i === 0 ? EXPLAIN.eox : "" });
      rows.push({ section: "Peaks", metric: "E_red",     cycle: cyc, value: fmt(eRed, 4), unit: "V", explanation: i === 0 ? EXPLAIN.ered : "" });
      rows.push({ section: "Peaks", metric: "ΔEp",       cycle: cyc, value: fmt(dEp, 2), unit: "mV", explanation: i === 0 ? EXPLAIN.dep : "" });
      rows.push({ section: "Peaks", metric: "E½",        cycle: cyc, value: fmt(eH, 4), unit: "V",   explanation: i === 0 ? EXPLAIN.ehalf : "" });
      rows.push({ section: "Peaks", metric: "|ip_c/ip_a|", cycle: cyc, value: fmt(rat, 3), unit: "—", explanation: i === 0 ? EXPLAIN.ratio : "" });
    });
    return rows;
  }
  getMetricRowsRef.current = buildMetricRows;

  // ── CSV builder ──────────────────────────────────────────────────────────────
  function buildCsv(): string {
    const cellLabel = cellConfig === "full_symmetric" ? "2-electrode symmetric (×2 correction applied)" : "3-electrode half-cell";
    const lines: string[] = [
      `# File: ${file.name}`,
      `# Analysis: CV`,
      `# Scan rate: ${scanRate} mV/s`,
      `# Cycles: ${safeLo}–${safeHi}`,
      `# Cell configuration: ${cellLabel}`,
      `Section,Metric,Cycle,Value,Unit,Explanation`,
    ];
    buildMetricRows().forEach(r => {
      lines.push(`${r.section},${r.metric},${r.cycle},${r.value},${r.unit},"${r.explanation.replace(/"/g, "'")}"`);
    });

    const srSection   = getSrCsvRef.current();
    if (srSection) lines.push(srSection);

    const dunnSection = getDunnCsvRef.current();
    if (dunnSection) lines.push(dunnSection);

    return lines.join("\n");
  }
  getCsvRef.current = buildCsv;

  const caps:  number[]     = data?.capacitances_mf ?? [];
  const areas: number[]     = data?.areas           ?? [];
  const peaks: PeakResult[] = data?.peaks           ?? [];

  const capFactor   = cellConfig === "full_symmetric" ? 2 : 1;
  const displayCaps = caps.map(c => c * capFactor);

  function buildSummary(): PanelSummary {
    const cellLabel = cellConfig === "full_symmetric" ? "2-electrode symmetric (×2 correction applied)" : "3-electrode half-cell";
    const settings: string[] = [
      `Scan rate: ${scanRate} mV/s${detectedRate != null ? " (from file metadata)" : " (user-entered)"}`,
      `Cycles analysed: ${safeLo}–${safeHi} of ${total}`,
      `Cell configuration: ${cellLabel}`,
    ];
    if (vOffset !== 0) settings.push(`Reference conversion: ${refFrom} → ${refTo} (offset ${vOffset >= 0 ? "+" : ""}${vOffset.toFixed(3)} V)`);
    if (norm !== "none") settings.push(`Normalisation: by ${norm} (${normVal} ${norm === "area" ? "cm²" : "mg"})`);

    const values: string[] = [];
    if (displayCaps.length >= 2) {
      values.push(`C (mean ± std, cycles ${safeLo}–${safeHi}): ${mean(displayCaps).toFixed(4)} ± ${std(displayCaps).toFixed(4)} mF [C = ∫I dV / (2·ΔV·ν)${capFactor === 2 ? "; ×2 two-electrode correction applied" : ""}]`);
      values.push(`Loop area (mean ± std): ${mean(areas).toFixed(4)} ± ${std(areas).toFixed(4)} mA·V [area = ∫I dV]`);
    } else if (displayCaps.length === 1) {
      values.push(`C: ${fmt(displayCaps[0], 4)} mF [C = ∫I dV / (2·ΔV·ν)${capFactor === 2 ? "; ×2 two-electrode correction applied" : ""}]`);
      values.push(`Loop area: ${fmt(areas[0], 4)} mA·V [area = ∫I dV]`);
    }
    peaks.forEach((pk, i) => {
      const eOx  = pk.oxidation.voltages[0];
      const eRed = pk.reduction.voltages[0];
      const ipA  = pk.oxidation.currents[0];
      const ipC  = pk.reduction.currents[0];
      const dEp  = eOx != null && eRed != null ? (eOx - eRed) * 1000 : null;
      const eH   = eOx != null && eRed != null ? (eOx + eRed) / 2 : null;
      const rat  = ipA != null && ipC != null && ipA !== 0 ? Math.abs(ipC / ipA) : null;
      values.push(`Cycle ${selectedIndices[i] + 1}: E_ox=${fmt(eOx, 4)} V  E_red=${fmt(eRed, 4)} V  ΔEp=${fmt(dEp, 2)} mV  E½=${fmt(eH, 4)} V  |ip_c/ip_a|=${fmt(rat, 3)}`);
    });

    const srLines   = getSrSummaryRef.current();
    const dunnLines = getDunnSummaryRef.current();

    const warnings: string[] = [];
    if (!data) warnings.push("Analysis not yet run or failed");
    else if (peaks.length === 0) warnings.push("No peaks detected");

    const definitions = [
      `C: ${EXPLAIN.c}`,
      `ΔEp: ${EXPLAIN.dep}`,
      `E½: ${EXPLAIN.ehalf}`,
      `|ip_c/ip_a|: ${EXPLAIN.ratio}`,
    ];

    const metricRows = buildMetricRows();
    const dataTableLines = ["Section,Metric,Cycle,Value,Unit", ...metricRows.map(r => `${r.section},${r.metric},${r.cycle},${r.value},${r.unit}`)];

    return {
      etypeLabel: "CV analysis",
      sections: [
        { title: "Instrument metadata", lines: metaLines(file.metadata) },
        { title: "Analysis settings", lines: settings },
        { title: "Computed values", lines: values },
        { title: "Scan-rate (power-law / Trasatti) analysis", lines: srLines.length ? srLines : ["(not run — open the Scan Rate Analysis section and click Run analysis)"] },
        { title: "Dunn analysis", lines: dunnLines.length ? dunnLines : ["(not run — open the Dunn Analysis section and click Run analysis)"] },
        { title: "Warnings", lines: warnings.length ? warnings : ["(none)"] },
        { title: "Definitions", lines: definitions },
        { title: "Data table (metric rows)", lines: dataTableLines },
      ],
      llmInstructions: `Do not make assumptions about the experimental setup. First ask the user for any missing\ninformation that could materially affect interpretation of this cyclic voltammetry\nanalysis (working electrode, electrolyte, reference electrode, counter electrode, scan\nrate confirmation, cell configuration confirmation, temperature, experimental objective).\nOnce sufficient context has been provided, interpret the values quantitatively, explain\nany uncertainty, list possible explanations for anomalies, and suggest follow-up\nexperiments to distinguish between them.`,
    };
  }
  getSummaryRef.current = buildSummary;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 bg-panel-header border-b border-panel-border text-xs text-panel-text shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold">Scan rate:</span>
          {detectedRate != null
            ? <span className="text-forest-500">{detectedRate} mV/s <span className="text-panel-muted text-[10px]">(auto)</span></span>
            : (
              <label className="flex items-center gap-1">
                <input type="number" value={manualRate} min={0.001} step={0.1}
                       onChange={e => setManualRate(Number(e.target.value))}
                       className="w-16 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text" />
                <span className="text-panel-muted text-[10px]">mV/s</span>
              </label>
            )
          }
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-[11px]">Cell:</span>
          <div className="flex rounded border border-panel-border overflow-hidden text-[10px] font-medium">
            <button
              onClick={() => setCellConfig("half")}
              className={`px-2.5 py-0.5 transition-colors cursor-pointer ${cellConfig === "half" ? "bg-forest-600 text-white" : "bg-panel-bg text-panel-muted hover:bg-panel-header"}`}
            >3-electrode</button>
            <button
              onClick={() => setCellConfig("full_symmetric")}
              className={`px-2.5 py-0.5 border-l border-panel-border transition-colors cursor-pointer ${cellConfig === "full_symmetric" ? "bg-amber-500 text-white" : "bg-panel-bg text-panel-muted hover:bg-panel-header"}`}
            >2-electrode</button>
          </div>
        </div>

        {(vOffset !== 0 || norm !== "none") && (
          <span className="text-[10px] text-panel-muted" title="Settings inherited from the plot panel">
            {vOffset !== 0 && `vs ${refTo}${refTo === "RHE" ? ` (pH ${pH})` : ""}`}
            {vOffset !== 0 && norm !== "none" && " · "}
            {norm === "area" && `per ${normVal} cm²`}
            {norm === "mass" && `per ${normVal} mg`}
          </span>
        )}

        {total > 1 && (
          <div className="flex items-center gap-1.5">
            <span className="font-semibold">Cycles:</span>
            <input type="number" value={safeLo} min={1} max={safeHi}
                   onChange={e => setLo(Math.max(1, Math.min(Number(e.target.value), safeHi)))}
                   className="w-10 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text text-center" />
            <span className="text-panel-muted">–</span>
            <input type="number" value={safeHi} min={safeLo} max={total}
                   onChange={e => setHi(Math.max(safeLo, Math.min(Number(e.target.value), total)))}
                   className="w-10 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text text-center" />
            <span className="text-panel-muted text-[10px]">/ {total}</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto bg-panel-bg">
        {isLoading && <div className="p-4 text-sm text-panel-muted text-center">Analysing…</div>}
        {isError   && <div className="p-4 text-sm text-red-500  text-center">Analysis failed</div>}

        {data && (
          <div className="flex flex-col divide-y divide-panel-border">

            {/* ── Capacitance & Area ── */}
            <SectionHeader label="Capacitance & Area" open={capOpen} onToggle={() => setCapOpen(o => !o)} />
            {capOpen && (
              <>
                {cellConfig === "full_symmetric" && (
                  <p className="px-3 py-1.5 text-[10px] text-amber-500 bg-amber-400/10 border-b border-amber-400/40">
                    2-electrode correction applied (×2): values show per-electrode capacitance. C_cell from the formula × 2 = C_electrode, because two series capacitors halve the cell capacitance vs a single electrode.
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="bg-panel-header">
                        <th className={thCls}>Cycle</th>
                        <th className={thCls}>
                          C{cellConfig === "full_symmetric" ? " elec" : ""} (mF)
                          {cellConfig === "full_symmetric" && <span className="ml-1 text-amber-600 text-[9px] font-bold">×2</span>}
                          {" "}<QBtn id="c" active={capExplain === "c"} onToggle={id => setCapExplain(p => p === id ? null : id)} />
                        </th>
                        <th className={thCls}>
                          Area (mA·V) <QBtn id="area" active={capExplain === "area"} onToggle={id => setCapExplain(p => p === id ? null : id)} />
                        </th>
                      </tr>
                      {capExplain && <ExplainRow cols={3} text={EXPLAIN[capExplain]} />}
                    </thead>
                    <tbody>
                      {displayCaps.map((c, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-panel-bg" : "bg-panel-bgalt"}>
                          <td className={tdCls}>{selectedIndices[i] + 1}</td>
                          <td className={tdCls}>{fmt(c, 3)}</td>
                          <td className={tdCls}>{fmt(areas[i], 4)}</td>
                        </tr>
                      ))}
                      {displayCaps.length >= 2 && (
                        <tr className="bg-panel-hl">
                          <td className={tdCls + " text-panel-muted font-semibold"}>Mean ± Std</td>
                          <td className={tdCls + " font-semibold"}>{mean(displayCaps).toFixed(3)} ± {std(displayCaps).toFixed(3)}</td>
                          <td className={tdCls + " font-semibold"}>{mean(areas).toFixed(4)} ± {std(areas).toFixed(4)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ── Peaks ── */}
            {peaks && (
              <>
                <SectionHeader label="Peaks" open={peaksOpen} onToggle={() => setPeaksOpen(o => !o)} />
                {peaksOpen && peaks.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="bg-panel-header">
                          <th className={thCls}>Cycle</th>
                          <th className={thCls}>E_ox (V) <QBtn id="eox" active={peakExplain === "eox"} onToggle={id => setPeakExplain(p => p === id ? null : id)} /></th>
                          <th className={thCls}>E_red (V) <QBtn id="ered" active={peakExplain === "ered"} onToggle={id => setPeakExplain(p => p === id ? null : id)} /></th>
                          <th className={thCls}>ΔEp (mV) <QBtn id="dep" active={peakExplain === "dep"} onToggle={id => setPeakExplain(p => p === id ? null : id)} /></th>
                          <th className={thCls}>E½ (V) <QBtn id="ehalf" active={peakExplain === "ehalf"} onToggle={id => setPeakExplain(p => p === id ? null : id)} /></th>
                          <th className={thCls}>|ip_c/ip_a| <QBtn id="ratio" active={peakExplain === "ratio"} onToggle={id => setPeakExplain(p => p === id ? null : id)} /></th>
                        </tr>
                        {peakExplain && <ExplainRow cols={6} text={EXPLAIN[peakExplain]} />}
                      </thead>
                      <tbody>
                        {peaks.map((pk, i) => {
                          const eOx  = pk.oxidation.voltages[0];
                          const eRed = pk.reduction.voltages[0];
                          const ipA  = pk.oxidation.currents[0];
                          const ipC  = pk.reduction.currents[0];
                          const dEp  = eOx != null && eRed != null ? (eOx - eRed) * 1000 : null;
                          const eH   = eOx != null && eRed != null ? (eOx + eRed) / 2 : null;
                          const rat  = ipA != null && ipC != null && ipA !== 0 ? Math.abs(ipC / ipA) : null;
                          return (
                            <tr key={i} className={i % 2 === 0 ? "bg-panel-bg" : "bg-panel-bgalt"}>
                              <td className={tdCls}>{selectedIndices[i] + 1}</td>
                              <td className={tdCls}>{fmt(eOx, 4)}</td>
                              <td className={tdCls}>{fmt(eRed, 4)}</td>
                              <td className={tdCls}>{fmt(dEp, 2)}</td>
                              <td className={tdCls}>{fmt(eH, 4)}</td>
                              <td className={tdCls}>{fmt(rat, 3)}</td>
                            </tr>
                          );
                        })}
                        {peaks.length >= 2 && (() => {
                          const valid  = peaks.filter(pk => pk.oxidation.voltages[0] != null && pk.reduction.voltages[0] != null);
                          if (valid.length < 2) return null;
                          const dEps   = valid.map(pk => (pk.oxidation.voltages[0] - pk.reduction.voltages[0]) * 1000);
                          const eHalfs = valid.map(pk => (pk.oxidation.voltages[0] + pk.reduction.voltages[0]) / 2);
                          const ratios = peaks
                            .filter(pk => pk.oxidation.currents[0] != null && pk.reduction.currents[0] != null && pk.oxidation.currents[0] !== 0)
                            .map(pk => Math.abs(pk.reduction.currents[0] / pk.oxidation.currents[0]));
                          return (
                            <tr className="bg-panel-hl">
                              <td className={tdCls + " text-panel-muted font-semibold"}>Mean ± Std</td>
                              <td className={tdCls}>—</td><td className={tdCls}>—</td>
                              <td className={tdCls + " font-semibold"}>{mean(dEps).toFixed(2)} ± {std(dEps).toFixed(2)}</td>
                              <td className={tdCls + " font-semibold"}>{mean(eHalfs).toFixed(4)} ± {std(eHalfs).toFixed(4)}</td>
                              <td className={tdCls + " font-semibold"}>{ratios.length >= 2 ? `${mean(ratios).toFixed(3)} ± ${std(ratios).toFixed(3)}` : fmt(ratios[0], 3)}</td>
                            </tr>
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
                {peaksOpen && peaks.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-panel-muted italic">No peaks detected</p>
                )}
              </>
            )}

            {/* ── Scan Rate Analysis ── */}
            <SectionHeader label="Scan Rate Analysis" open={srOpen} onToggle={() => setSrOpen(o => !o)} />
            {srOpen && (
              <ScanRateAnalysis allCvFiles={allCvFiles} getSrCsvRef={getSrCsvRef} getSrPlotsRef={getSrPlotsRef} getSrSummaryRef={getSrSummaryRef} />
            )}

            {/* ── Dunn Analysis ── */}
            <SectionHeader label="Dunn Analysis (capacitive vs diffusion)" open={dunnOpen} onToggle={() => setDunnOpen(o => !o)} />
            {dunnOpen && (
              <DunnAnalysis allCvFiles={allCvFiles} getDunnCsvRef={getDunnCsvRef} getDunnPlotRef={getDunnPlotRef} getDunnSummaryRef={getDunnSummaryRef} />
            )}

          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ label, open, onToggle }: {
  label: string; open: boolean; onToggle: () => void;
}) {
  return (
    <div className="flex items-center px-3 py-2 bg-panel-header border-b border-panel-border">
      <button onClick={onToggle} className="flex-1 text-left text-xs font-medium text-panel-text flex items-center gap-1.5">
        <span className="text-panel-muted text-[10px]">{open ? "▴" : "▾"}</span>
        {label}
      </button>
    </div>
  );
}
