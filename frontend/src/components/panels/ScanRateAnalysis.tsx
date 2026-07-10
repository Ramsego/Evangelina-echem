import { useState, useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { ParsedFile, CVResponse } from "../../types";
import { analyzeCV } from "../../api/client";
import { parseScanRateMvs, LAYOUT_BASE } from "../../utils/plotUtils";
import { useFileLabels } from "../../context/FileLabelContext";
import { useStyle } from "../../context/StyleContext";
import { applyStyleToData, applyStyleToLayout } from "../../utils/applyStyle";
import { PALETTES } from "../../styles/styleTypes";
import ClampedPlot from "../ClampedPlot";

interface SrEntry {
  fileId:     string;
  cycleIndex: number;
}

interface FitResult {
  slope:     number;
  intercept: number;
  r2:        number;
}

// CSV explanation for scan rate section (used in buildSrCsv)
const EXPLAIN_SR_CSV = `b-value: log(ip) = b·log(ν) + log(a). b ≈ 1 → surface-controlled; b ≈ 0.5 → semi-infinite diffusion. All detected peaks included as separate data points.`;

function linearFit(x: number[], y: number[]): FitResult | null {
  const n = x.length;
  if (n < 2) return null;
  const sx  = x.reduce((s, v) => s + v, 0);
  const sy  = y.reduce((s, v) => s + v, 0);
  const sxy = x.reduce((s, v, i) => s + v * y[i], 0);
  const sx2 = x.reduce((s, v) => s + v * v, 0);
  const denom = n * sx2 - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const slope     = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const yMean = sy / n;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = y.reduce((s, v, i) => s + (v - (slope * x[i] + intercept)) ** 2, 0);
  const r2 = ssTot < 1e-12 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

function interpretB(b: number): string {
  if (b >= 0.85) return "surface-controlled";
  if (b <= 0.6)  return "diffusion-controlled";
  return "mixed";
}

function fmt(v: number | null | undefined, dp = 3): string {
  return v != null && Number.isFinite(v) ? v.toFixed(dp) : "—";
}

const thCls = "px-2 py-1 text-left text-[10px] font-semibold text-panel-muted uppercase tracking-wider border-b border-panel-border whitespace-nowrap";
const tdCls = "px-2 py-1 text-[11px] text-panel-text tabular-nums";
const selectCls = "bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-[10px] text-panel-text truncate max-w-[130px]";

const EXPLAIN_SR: Record<string, string> = {
  b:    "Slope of log(ip) vs. log(ν): b ≈ 1 means surface-controlled (capacitive or adsorption-limited); b ≈ 0.5 means semi-infinite diffusion (intercalation); values between indicate mixed control.",
  r2:   "Coefficient of determination of the log(ip) vs. log(ν) linear fit. R² → 1 confirms a clean power-law relationship; lower values suggest noise, competing mechanisms, or too few data points.",
  bSr:  "Analysis uses one selected cycle per file. All detected peaks at that scan rate are included as independent data points for the fit.",
};

function QBtn({ id, active, onToggle }: { id: string; active: boolean; onToggle: (id: string) => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(id); }}
      className={`ml-1 text-[9px] border rounded-full w-3.5 h-3.5 inline-flex items-center justify-center leading-none transition-colors cursor-pointer shrink-0 ${active ? "border-forest-400 text-forest-600 bg-panel-hl" : "border-panel-border text-panel-muted hover:text-forest-600 hover:border-forest-400"}`}
    >?</button>
  );
}

export interface SrPlotExport {
  data:   Plotly.Data[];
  layout: Partial<Plotly.Layout>;
  name:   string;
}

interface Props {
  allCvFiles:   ParsedFile[];
  getSrCsvRef:  React.MutableRefObject<() => string>;
  getSrPlotsRef: React.MutableRefObject<() => SrPlotExport[]>;
  getSrSummaryRef: React.MutableRefObject<() => string[]>;
}

export default function ScanRateAnalysis({ allCvFiles, getSrCsvRef, getSrPlotsRef, getSrSummaryRef }: Props) {
  const style = useStyle();
  const { getLabel } = useFileLabels();
  const [bExplain, setBExplain] = useState<string | null>(null);
  const toggleB = (id: string) => setBExplain(prev => prev === id ? null : id);

  const srFileMap = useMemo(
    () => Object.fromEntries(allCvFiles.map(f => [f.id, f])),
    [allCvFiles],
  );

  const [srEntries, setSrEntries] = useState<SrEntry[]>([]);
  const [srRunKey,  setSrRunKey]  = useState(0);

  // Remove entries whose source file has been deleted
  useEffect(() => {
    const validIds = new Set(allCvFiles.map(f => f.id));
    setSrEntries(prev => prev.filter(e => validIds.has(e.fileId)));
  }, [allCvFiles]);

  const srQueries = useQueries({
    queries: srEntries.map(entry => {
      const f     = srFileMap[entry.fileId];
      const curve = f?.curves?.[entry.cycleIndex - 1];
      const sr    = f ? parseScanRateMvs(f.metadata?.SCANRATE) : null;
      return {
        queryKey: ["cv-sr", entry.fileId, entry.cycleIndex, srRunKey],
        queryFn:  () => analyzeCV({
          curves:       [curve!],
          scan_rate_mv: sr ?? 10,
          detect_peaks: true,
          prominence:   0.05,
        }),
        enabled: srRunKey > 0 && !!curve && sr != null,
      };
    }),
  });

  const duplicates = useMemo(() => {
    const map = new Map<number, string[]>();
    srEntries.forEach(e => {
      const f  = srFileMap[e.fileId];
      const sr = f ? parseScanRateMvs(f.metadata?.SCANRATE) : null;
      if (sr != null) {
        if (!map.has(sr)) map.set(sr, []);
        map.get(sr)!.push(getLabel(e.fileId, f?.name ?? e.fileId));
      }
    });
    return Array.from(map.entries())
      .filter(([, names]) => names.length > 1)
      .map(([sr, names]) => `${names.join(" & ")} share scan rate ${sr} mV/s`);
  }, [srEntries, srFileMap]);

  const srLoading = srRunKey > 0 && srQueries.some(q => q.isLoading || q.isPending);
  const srQueriesKey = srQueries.map(q => q.dataUpdatedAt).join(",");

  const bValueData = useMemo(() => {
    if (srRunKey === 0) return null;
    if (srQueries.some(q => q.isLoading || q.isPending)) return null;

    type Pt = { sr: number; ip: number };
    const oxPoints:  Pt[] = [];
    const redPoints: Pt[] = [];
    const capPoints: { sr: number; capMf: number }[] = [];

    srEntries.forEach((entry, i) => {
      const f      = srFileMap[entry.fileId];
      const sr     = f ? parseScanRateMvs(f.metadata?.SCANRATE) : null;
      const qData  = srQueries[i]?.data as CVResponse | undefined;
      if (!sr || !qData || sr <= 0) return;

      (qData.peaks?.[0]?.oxidation?.currents ?? []).forEach((ip: number) => {
        if (ip > 0) oxPoints.push({ sr, ip });
      });
      (qData.peaks?.[0]?.reduction?.currents ?? []).forEach((ip: number) => {
        if (Math.abs(ip) > 0) redPoints.push({ sr, ip: Math.abs(ip) });
      });
      const capMf = qData.capacitances_mf?.[0];
      if (capMf != null && capMf > 0) capPoints.push({ sr, capMf });
    });

    const oxFit  = linearFit(oxPoints.map(p => Math.log10(p.sr)),  oxPoints.map(p => Math.log10(p.ip)));
    const redFit = linearFit(redPoints.map(p => Math.log10(p.sr)), redPoints.map(p => Math.log10(p.ip)));
    const cFit   = linearFit(capPoints.map(p => Math.sqrt(p.sr)),  capPoints.map(p => p.capMf));

    return { oxPoints, redPoints, capPoints, oxFit, redFit, cFit };
    // srQueries identity changes every render; srQueriesKey captures when results actually settle
  }, [srRunKey, srEntries, srFileMap, srQueriesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildSrCsv(): string {
    if (!bValueData) return "";
    const lines: string[] = [];
    bValueData.oxPoints.forEach(p =>
      lines.push(`Scan Rate Analysis,ip_ox,ν=${p.sr},${fmt(p.ip, 4)},mA,""`));
    bValueData.redPoints.forEach(p =>
      lines.push(`Scan Rate Analysis,ip_red,ν=${p.sr},${fmt(p.ip, 4)},mA,""`));
    if (bValueData.oxFit)
      lines.push(`Scan Rate Analysis,b (oxidation),—,${fmt(bValueData.oxFit.slope, 3)},—,"${EXPLAIN_SR_CSV.replace(/"/g, "'")}"`);
    if (bValueData.redFit)
      lines.push(`Scan Rate Analysis,b (reduction),—,${fmt(bValueData.redFit.slope, 3)},—,""`);
    bValueData.capPoints.forEach(p =>
      lines.push(`Scan Rate Analysis,C,ν=${p.sr},${fmt(p.capMf, 4)},mF,""`));
    if (bValueData.cFit)
      lines.push(`Scan Rate Analysis,C vs √ν slope,—,${fmt(bValueData.cFit.slope, 4)},mF·s^0.5·mV^-0.5,""`);
    return lines.join("\n");
  }

  getSrCsvRef.current = buildSrCsv;

  function buildSrSummary(): string[] {
    if (!bValueData) return [];
    const lines: string[] = [];
    if (bValueData.oxFit) {
      lines.push(`b (oxidation): ${fmt(bValueData.oxFit.slope, 3)} (R² = ${fmt(bValueData.oxFit.r2, 3)}) [${EXPLAIN_SR_CSV}]`);
    }
    if (bValueData.redFit) {
      lines.push(`b (reduction): ${fmt(bValueData.redFit.slope, 3)} (R² = ${fmt(bValueData.redFit.r2, 3)})`);
    }
    if (!bValueData.oxFit && !bValueData.redFit) {
      lines.push("No peaks detected in selected files");
    }
    if (bValueData.cFit) {
      lines.push(`C vs √ν slope: ${fmt(bValueData.cFit.slope, 4)} mF·s^0.5·mV^-0.5 (R² = ${fmt(bValueData.cFit.r2, 3)})`);
    }

    if (bValueData.oxPoints.length > 0 || bValueData.redPoints.length > 0) {
      lines.push("", "Peak currents by scan rate:");
      const rates = Array.from(new Set([
        ...bValueData.oxPoints.map(p => p.sr),
        ...bValueData.redPoints.map(p => p.sr),
      ])).sort((a, b) => a - b);
      rates.forEach(sr => {
        const oxIps  = bValueData.oxPoints.filter(p => p.sr === sr).map(p => fmt(p.ip, 4));
        const redIps = bValueData.redPoints.filter(p => p.sr === sr).map(p => fmt(p.ip, 4));
        lines.push(`  ν=${sr} mV/s: ip_ox=[${oxIps.join(", ")}] mA, ip_red=[${redIps.join(", ")}] mA`);
      });
    }

    if (bValueData.capPoints.length > 0) {
      lines.push("", "Capacitance by scan rate:");
      bValueData.capPoints.slice().sort((a, b) => a.sr - b.sr).forEach(p => {
        lines.push(`  ν=${p.sr} mV/s: C=${fmt(p.capMf, 4)} mF`);
      });
    }

    return lines;
  }

  getSrSummaryRef.current = buildSrSummary;

  const srPlots = useMemo((): SrPlotExport[] => {
    if (!bValueData) return [];
    const palette = style.customPalette ?? PALETTES[style.colorScheme] ?? PALETTES["Forest"];
    const c0 = palette[0] ?? "#52B788";
    const c1 = palette[1] ?? "#F4A261";
    const c2 = palette[2] ?? "#74C69D";
    const plots: SrPlotExport[] = [];

    if (bValueData.oxPoints.length > 0 || bValueData.redPoints.length > 0) {
      const allLogSr = [
        ...bValueData.oxPoints.map(p => Math.log10(p.sr)),
        ...bValueData.redPoints.map(p => Math.log10(p.sr)),
      ];
      const x0 = Math.min(...allLogSr) - 0.3;
      const x1 = Math.max(...allLogSr) + 0.3;
      const rawData1: Plotly.Data[] = [
        ...(bValueData.oxPoints.length > 0 ? [{
          x: bValueData.oxPoints.map(p => Math.log10(p.sr)),
          y: bValueData.oxPoints.map(p => Math.log10(p.ip)),
          mode: "markers" as const, type: "scatter" as const, name: "Oxidation",
          marker: { color: c0, size: 7 },
        }] : []),
        ...(bValueData.redPoints.length > 0 ? [{
          x: bValueData.redPoints.map(p => Math.log10(p.sr)),
          y: bValueData.redPoints.map(p => Math.log10(p.ip)),
          mode: "markers" as const, type: "scatter" as const, name: "Reduction",
          marker: { color: c1, size: 7 },
        }] : []),
        ...(bValueData.oxFit ? [{
          x: [x0, x1], y: [x0, x1].map(x => bValueData.oxFit!.slope * x + bValueData.oxFit!.intercept),
          mode: "lines" as const, type: "scatter" as const,
          name: `b_ox = ${bValueData.oxFit.slope.toFixed(2)} (R²=${bValueData.oxFit.r2.toFixed(2)})`,
          line: { dash: "dash" as const, color: c0, width: 1.5 },
        }] : []),
        ...(bValueData.redFit ? [{
          x: [x0, x1], y: [x0, x1].map(x => bValueData.redFit!.slope * x + bValueData.redFit!.intercept),
          mode: "lines" as const, type: "scatter" as const,
          name: `b_red = ${bValueData.redFit.slope.toFixed(2)} (R²=${bValueData.redFit.r2.toFixed(2)})`,
          line: { dash: "dash" as const, color: c1, width: 1.5 },
        }] : []),
      ];
      plots.push({
        name:   "bvalue",
        data:   applyStyleToData(rawData1, style),
        layout: applyStyleToLayout({
          ...LAYOUT_BASE, height: 240,
          xaxis: { ...LAYOUT_BASE.xaxis, title: { text: "log₁₀(ν / mV·s⁻¹)", font: { color: "#74C69D" } } },
          yaxis: { ...LAYOUT_BASE.yaxis, title: { text: "log₁₀(ip / mA)",     font: { color: "#74C69D" } } },
          margin: { t: 20, r: 10, b: 48, l: 60 },
        }, style),
      });
    }

    if (bValueData.capPoints.length >= 2) {
      const sqrtSrs = bValueData.capPoints.map(p => Math.sqrt(p.sr));
      const xMin2   = Math.min(...sqrtSrs) * 0.9;
      const xMax2   = Math.max(...sqrtSrs) * 1.1;
      const rawData2: Plotly.Data[] = [
        {
          x: sqrtSrs, y: bValueData.capPoints.map(p => p.capMf),
          mode: "markers" as const, type: "scatter" as const, name: "C (mF)",
          marker: { color: c2, size: 7 },
        },
        ...(bValueData.cFit ? [{
          x: [xMin2, xMax2],
          y: [xMin2, xMax2].map(x => bValueData.cFit!.slope * x + bValueData.cFit!.intercept),
          mode: "lines" as const, type: "scatter" as const,
          name: `slope = ${bValueData.cFit.slope.toFixed(3)} (R²=${bValueData.cFit.r2.toFixed(2)})`,
          line: { dash: "dash" as const, color: c2, width: 1.5 },
        }] : []),
      ];
      plots.push({
        name:   "cvssqrtnu",
        data:   applyStyleToData(rawData2, style),
        layout: applyStyleToLayout({
          ...LAYOUT_BASE, height: 220,
          xaxis: { ...LAYOUT_BASE.xaxis, title: { text: "√ν (mV/s)^½", font: { color: "#74C69D" } } },
          yaxis: { ...LAYOUT_BASE.yaxis, title: { text: "C (mF)",       font: { color: "#74C69D" } } },
          margin: { t: 20, r: 10, b: 48, l: 60 },
        }, style),
      });
    }

    return plots;
  }, [bValueData, style]); // eslint-disable-line react-hooks/exhaustive-deps

  getSrPlotsRef.current = () => srPlots;

  const validEntryCount = srEntries.filter(e =>
    srFileMap[e.fileId] && parseScanRateMvs(srFileMap[e.fileId].metadata?.SCANRATE) != null
  ).length;

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {allCvFiles.length < 2 && (
        <p className="text-[11px] text-amber-500 bg-amber-400/10 border border-amber-400/40 rounded px-2 py-1.5">
          Load CV files at at least two different scan rates to enable this analysis.
        </p>
      )}

      {srEntries.length === 0 && allCvFiles.length >= 2 && (
        <p className="text-[11px] text-panel-muted italic">
          Use the dropdown below to add the files you'd like to include.
        </p>
      )}

      {duplicates.map((msg, i) => (
        <p key={i} className="text-[11px] text-orange-500 bg-orange-400/10 border border-orange-400/40 rounded px-2 py-1">
          ⚠ {msg}
        </p>
      ))}

      {srEntries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead><tr className="bg-panel-header">
              <th className={thCls}>File</th>
              <th className={thCls}>ν (mV/s)</th>
              <th className={thCls}>Cycle</th>
              <th className={thCls}></th>
            </tr></thead>
            <tbody>
              {srEntries.map((entry, i) => {
                const f        = srFileMap[entry.fileId];
                const sr       = f ? parseScanRateMvs(f.metadata?.SCANRATE) : null;
                const maxCycle = f?.curves?.length ?? 1;
                return (
                  <tr key={i} className={i % 2 === 0 ? "bg-panel-bg" : "bg-panel-bgalt"}>
                    <td className="px-2 py-1">
                      <select
                        value={entry.fileId}
                        onChange={e => setSrEntries(prev => prev.map((en, j) =>
                          j === i ? { fileId: e.target.value, cycleIndex: 1 } : en
                        ))}
                        className={selectCls}
                      >
                        {allCvFiles.map(f2 => (
                          <option key={f2.id} value={f2.id}>{getLabel(f2.id, f2.name)}</option>
                        ))}
                      </select>
                    </td>
                    <td className={tdCls}>{sr != null ? sr : <span className="text-panel-muted">—</span>}</td>
                    <td className="px-2 py-1">
                      <input
                        type="number" value={entry.cycleIndex} min={1} max={maxCycle}
                        onChange={e => setSrEntries(prev => prev.map((en, j) =>
                          j === i ? { ...en, cycleIndex: Math.min(Math.max(1, Number(e.target.value)), maxCycle) } : en
                        ))}
                        className="w-10 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-[10px] text-panel-text"
                      />
                      <span className="text-[10px] text-panel-muted ml-1">/ {maxCycle}</span>
                    </td>
                    <td className="px-2 py-1">
                      <button
                        onClick={() => setSrEntries(prev => prev.filter((_, j) => j !== i))}
                        className="text-panel-muted hover:text-red-400 transition-colors text-[11px]"
                      >✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {allCvFiles.some(f => !srEntries.find(e => e.fileId === f.id)) && (
        <select
          value=""
          onChange={e => {
            if (!e.target.value) return;
            const f = srFileMap[e.target.value];
            const defaultCycle = Math.min(3, f?.curves?.length ?? f?.total_curves ?? 1);
            setSrEntries(prev => [...prev, { fileId: e.target.value, cycleIndex: defaultCycle }]);
          }}
          className="text-[10px] bg-panel-bg border border-panel-border rounded px-2 py-1 text-panel-muted self-start"
        >
          <option value="">+ Add file…</option>
          {allCvFiles
            .filter(f => !srEntries.find(e => e.fileId === f.id))
            .map(f => <option key={f.id} value={f.id}>{getLabel(f.id, f.name)}</option>)
          }
        </select>
      )}

      <button
        onClick={() => setSrRunKey(k => k + 1)}
        disabled={validEntryCount < 2}
        className="self-start text-[11px] bg-forest-600 hover:bg-forest-700 text-white rounded px-3 py-1 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
      >
        {srLoading ? "Running…" : srRunKey > 0 ? "Re-run" : "Run analysis"}
      </button>

      {srLoading && <p className="text-[11px] text-panel-muted">Analysing…</p>}

      {bValueData && (
        <div className="flex flex-col gap-3 pt-1">

          {/* b-value plot: log(ip) vs log(ν) */}
          {srPlots[0] && (
            <ClampedPlot data={srPlots[0].data} layout={srPlots[0].layout}
              resetKey={`scan-rate-b-${srRunKey}`}
              config={{ responsive: true, displayModeBar: "hover", displaylogo: false }}
              style={{ width: "100%", height: "240px" }} useResizeHandler legendStyle={style} />
          )}

          {/* C vs √ν plot */}
          {srPlots[1] && (
            <ClampedPlot data={srPlots[1].data} layout={srPlots[1].layout}
              resetKey={`scan-rate-cap-${srRunKey}`}
              config={{ responsive: true, displayModeBar: "hover", displaylogo: false }}
              style={{ width: "100%", height: "220px" }} useResizeHandler legendStyle={style} />
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-panel-header">
                  <th className={thCls}>Series</th>
                  <th className={thCls}>
                    b-value <QBtn id="b" active={bExplain === "b"} onToggle={toggleB} />
                  </th>
                  <th className={thCls}>
                    R² <QBtn id="r2" active={bExplain === "r2"} onToggle={toggleB} />
                  </th>
                  <th className={thCls}>Interpretation</th>
                </tr>
                {bExplain && (
                  <tr className="bg-panel-hl">
                    <td colSpan={4} className="px-3 py-2 text-[11px] text-panel-muted leading-relaxed border-b border-panel-hlbdr">
                      {EXPLAIN_SR[bExplain!]}
                    </td>
                  </tr>
                )}
              </thead>
              <tbody>
                {bValueData.oxFit && (
                  <tr className="bg-panel-bg">
                    <td className={tdCls + " font-medium text-panel-muted"}>Oxidation</td>
                    <td className={tdCls + " font-semibold"}>{fmt(bValueData.oxFit.slope, 3)}</td>
                    <td className={tdCls}>{fmt(bValueData.oxFit.r2, 3)}</td>
                    <td className={tdCls + " text-panel-muted"}>{interpretB(bValueData.oxFit.slope)}</td>
                  </tr>
                )}
                {bValueData.redFit && (
                  <tr className="bg-panel-bgalt">
                    <td className={tdCls + " font-medium text-panel-muted"}>Reduction</td>
                    <td className={tdCls + " font-semibold"}>{fmt(bValueData.redFit.slope, 3)}</td>
                    <td className={tdCls}>{fmt(bValueData.redFit.r2, 3)}</td>
                    <td className={tdCls + " text-panel-muted"}>{interpretB(bValueData.redFit.slope)}</td>
                  </tr>
                )}
                {!bValueData.oxFit && !bValueData.redFit && (
                  <tr><td colSpan={4} className={tdCls + " text-panel-muted italic"}>No peaks detected in selected files</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {(bValueData.oxPoints.length > 0 || bValueData.redPoints.length > 0) && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead><tr className="bg-panel-header">
                  <th className={thCls}>ν (mV/s)</th>
                  <th className={thCls}>log ν</th>
                  <th className={thCls}>ip_ox (mA)</th>
                  <th className={thCls}>log ip_ox</th>
                  <th className={thCls}>ip_red (mA)</th>
                  <th className={thCls}>log |ip_red|</th>
                </tr></thead>
                <tbody>
                  {Array.from(new Set([
                    ...bValueData.oxPoints.map(p => p.sr),
                    ...bValueData.redPoints.map(p => p.sr),
                  ])).sort((a, b) => a - b).map((sr, i) => {
                    const oxPts   = bValueData.oxPoints.filter(p => p.sr === sr);
                    const redPts  = bValueData.redPoints.filter(p => p.sr === sr);
                    const maxRows = Math.max(oxPts.length, redPts.length, 1);
                    return Array.from({ length: maxRows }, (_, j) => (
                      <tr key={`${sr}-${j}`} className={i % 2 === 0 ? "bg-panel-bg" : "bg-panel-bgalt"}>
                        <td className={tdCls}>{j === 0 ? sr : ""}</td>
                        <td className={tdCls}>{j === 0 ? Math.log10(sr).toFixed(3) : ""}</td>
                        <td className={tdCls}>{fmt(oxPts[j]?.ip, 4)}</td>
                        <td className={tdCls}>{oxPts[j] ? Math.log10(oxPts[j].ip).toFixed(4) : "—"}</td>
                        <td className={tdCls}>{fmt(redPts[j]?.ip, 4)}</td>
                        <td className={tdCls}>{redPts[j] ? Math.log10(redPts[j].ip).toFixed(4) : "—"}</td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          )}

          {bValueData.capPoints.length >= 2 && (
            <div className="overflow-x-auto">
              <p className="text-[10px] font-semibold text-panel-muted uppercase tracking-wider px-1 mb-1">C vs √ν</p>
              <table className="w-full border-collapse text-left">
                <thead><tr className="bg-panel-header">
                  <th className={thCls}>ν (mV/s)</th>
                  <th className={thCls}>√ν</th>
                  <th className={thCls}>C (mF)</th>
                </tr></thead>
                <tbody>
                  {bValueData.capPoints.sort((a, b) => a.sr - b.sr).map((p, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-panel-bg" : "bg-panel-bgalt"}>
                      <td className={tdCls}>{p.sr}</td>
                      <td className={tdCls}>{Math.sqrt(p.sr).toFixed(4)}</td>
                      <td className={tdCls}>{fmt(p.capMf, 4)}</td>
                    </tr>
                  ))}
                  {bValueData.cFit && (
                    <tr className="bg-panel-hl">
                      <td colSpan={2} className={tdCls + " font-semibold text-panel-muted"}>
                        Slope: {fmt(bValueData.cFit.slope, 4)} mF/(mV/s)^0.5
                      </td>
                      <td className={tdCls + " font-semibold"}>R² = {fmt(bValueData.cFit.r2, 3)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
