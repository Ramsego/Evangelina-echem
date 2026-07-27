import { useState, useEffect, useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ParsedFile, CVResponse, BValueProfileResponse } from "../../types";
import { analyzeCV, analyzeBValueProfile } from "../../api/client";
import { parseScanRateMvs, LAYOUT_BASE } from "../../utils/plotUtils";
import { useFileLabels } from "../../context/FileLabelContext";
import { useStyle } from "../../context/StyleContext";
import { applyStyleToData, applyStyleToLayout, StyledTrace } from "../../utils/applyStyle";
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

function fmt(v: number | null | undefined, dp = 3): string {
  return v != null && Number.isFinite(v) ? v.toFixed(dp) : "—";
}

const thCls = "px-2 py-1 text-left text-[10px] font-semibold text-panel-muted uppercase tracking-wider border-b border-panel-border whitespace-nowrap";
const tdCls = "px-2 py-1 text-[11px] text-panel-text tabular-nums";
const selectCls = "bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-[10px] text-panel-text truncate max-w-[130px]";

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
        }),
        enabled: srRunKey > 0 && !!curve && sr != null,
      };
    }),
  });

  const validProfileEntries = srEntries.filter(e => {
    const f     = srFileMap[e.fileId];
    const curve = f?.curves?.[e.cycleIndex - 1];
    const sr    = f ? parseScanRateMvs(f.metadata?.SCANRATE) : null;
    return !!curve && sr != null;
  });

  const bProfileBody = useMemo(() => {
    if (srRunKey === 0 || validProfileEntries.length < 3) return null;
    return {
      entries: validProfileEntries.map(e => {
        const f     = srFileMap[e.fileId];
        const curve = f!.curves![e.cycleIndex - 1];
        const sr    = parseScanRateMvs(f!.metadata?.SCANRATE)!;
        return { vf: curve.vf, im: curve.im, scan_rate_mv: sr };
      }),
    };
    // srRunKey intentional — gates re-computation to the entries present at "Run" time
  }, [srRunKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: bProfileData, isLoading: bProfileLoading } = useQuery<BValueProfileResponse>({
    queryKey: ["bvalue-profile", srRunKey],
    queryFn:  () => analyzeBValueProfile(bProfileBody!),
    enabled:  srRunKey > 0 && bProfileBody != null,
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

  const srLoading = srRunKey > 0 && (srQueries.some(q => q.isLoading || q.isPending) || bProfileLoading);
  const srQueriesKey = srQueries.map(q => q.dataUpdatedAt).join(",");

  const bValueData = useMemo(() => {
    if (srRunKey === 0) return null;
    if (srQueries.some(q => q.isLoading || q.isPending)) return null;

    const capPoints: { sr: number; capMf: number }[] = [];

    srEntries.forEach((entry, i) => {
      const f      = srFileMap[entry.fileId];
      const sr     = f ? parseScanRateMvs(f.metadata?.SCANRATE) : null;
      const qData  = srQueries[i]?.data as CVResponse | undefined;
      if (!sr || !qData || sr <= 0) return;

      const capMf = qData.capacitances_mf?.[0];
      if (capMf != null && capMf > 0) capPoints.push({ sr, capMf });
    });

    const cFit = linearFit(capPoints.map(p => Math.sqrt(p.sr)), capPoints.map(p => p.capMf));

    return { capPoints, cFit };
    // srQueries identity changes every render; srQueriesKey captures when results actually settle
  }, [srRunKey, srEntries, srFileMap, srQueriesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildSrCsv(): string {
    if (!bValueData) return "";
    const lines: string[] = [];
    bValueData.capPoints.forEach(p =>
      lines.push(`Scan Rate Analysis,C,ν=${p.sr},${fmt(p.capMf, 4)},mF,""`));
    if (bValueData.cFit)
      lines.push(`Scan Rate Analysis,Trasatti slope (C vs √ν),—,${fmt(bValueData.cFit.slope, 4)},mF·s^0.5·mV^-0.5,""`);
    for (const [branch, label] of [["anodic", "b(E) anodic"], ["cathodic", "b(E) cathodic"]] as const) {
      const br = bProfileData?.[branch];
      if (br) br.voltages.forEach((v, i) =>
        lines.push(`Scan Rate Analysis,${label},E=${v.toFixed(4)},${fmt(br.b[i], 3)},—,""`));
    }
    return lines.join("\n");
  }

  getSrCsvRef.current = buildSrCsv;

  function buildSrSummary(): string[] {
    if (!bValueData) return [];
    const lines: string[] = [];
    if (bValueData.cFit) {
      lines.push(`Trasatti slope (C vs √ν): ${fmt(bValueData.cFit.slope, 4)} mF·s^0.5·mV^-0.5 (R² = ${fmt(bValueData.cFit.r2, 3)})`);
    }

    if (bProfileData && (bProfileData.anodic || bProfileData.cathodic)) {
      lines.push(
        "",
        "Power-law (Lindström) b(E): log|i(V,ν)| = b(V)·log(ν) + log(a(V)), fit at every potential across the sweep, per branch. b ≈ 1 → surface-controlled; b ≈ 0.5 → semi-infinite diffusion. Full E,b table included in CSV export.",
      );
      for (const [branch, label] of [["anodic", "anodic"], ["cathodic", "cathodic"]] as const) {
        const br = bProfileData[branch];
        if (!br) continue;
        const valid = br.voltages
          .map((v, i) => ({ v, b: br.b[i] }))
          .filter((p): p is { v: number; b: number } => p.b != null);
        if (valid.length === 0) continue;
        const minP = valid.reduce((a, c) => c.b < a.b ? c : a);
        const maxP = valid.reduce((a, c) => c.b > a.b ? c : a);
        lines.push(`  ${label}: most diffusion-controlled near E=${fmt(minP.v, 3)} V (b=${fmt(minP.b, 3)}); most surface-controlled near E=${fmt(maxP.v, 3)} V (b=${fmt(maxP.b, 3)})`);
      }
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
    const c0 = palette[0] ?? "#74C69D";
    const c1 = palette[1] ?? "#9d7bd8";
    const plots: SrPlotExport[] = [];

    if (bValueData.capPoints.length >= 2) {
      const sqrtSrs = bValueData.capPoints.map(p => Math.sqrt(p.sr));
      const xMin2   = Math.min(...sqrtSrs) * 0.9;
      const xMax2   = Math.max(...sqrtSrs) * 1.1;
      const rawData2: Plotly.Data[] = [
        {
          x: sqrtSrs, y: bValueData.capPoints.map(p => p.capMf),
          mode: "markers" as const, type: "scatter" as const, name: "C (mF)",
          marker: { color: c0, size: 7 },
        },
        ...(bValueData.cFit ? [{
          x: [xMin2, xMax2],
          y: [xMin2, xMax2].map(x => bValueData.cFit!.slope * x + bValueData.cFit!.intercept),
          mode: "lines" as const, type: "scatter" as const,
          name: `slope = ${bValueData.cFit.slope.toFixed(3)} (R²=${bValueData.cFit.r2.toFixed(2)})`,
          line: { dash: "dash" as const, color: c0, width: 1.5 },
        }] : []),
      ];
      plots.push({
        name:   "trasatti",
        data:   applyStyleToData(rawData2, style),
        layout: applyStyleToLayout({
          ...LAYOUT_BASE, height: 220,
          xaxis: { ...LAYOUT_BASE.xaxis, title: { text: "√ν (mV/s)^½", font: { color: "#74C69D" } } },
          yaxis: { ...LAYOUT_BASE.yaxis, title: { text: "C (mF)",       font: { color: "#74C69D" } } },
          margin: { t: 20, r: 10, b: 48, l: 60 },
        }, style),
      });
    }

    const branches = [
      bProfileData?.anodic   ? { br: bProfileData.anodic,   name: "b(E) anodic" }   : null,
      bProfileData?.cathodic ? { br: bProfileData.cathodic, name: "b(E) cathodic" } : null,
    ].filter(x => x != null);

    if (branches.length > 0) {
      const allVs = branches.flatMap(x => x!.br.voltages);
      const vLo  = Math.min(...allVs);
      const vHi  = Math.max(...allVs);
      const refLineColor = "rgba(160,160,160,0.7)";
      const rawData3: StyledTrace[] = [
        ...branches.map((x, k) => ({
          x: x!.br.voltages, y: x!.br.b,
          mode: "lines" as const, type: "scatter" as const, name: x!.name,
          line: { color: k === 0 ? c1 : (palette[2] ?? "#e07b91"), width: 2 },
          connectgaps: false,
        })),
        {
          x: [vLo, vHi], y: [1, 1],
          mode: "lines" as const, type: "scatter" as const, name: "b = 1 (surface-controlled)",
          line: { color: refLineColor, width: 1, dash: "dot" as const }, fixedColor: refLineColor,
          hoverinfo: "skip" as const,
        },
        {
          x: [vLo, vHi], y: [0.5, 0.5],
          mode: "lines" as const, type: "scatter" as const, name: "b = 0.5 (diffusion-controlled)",
          line: { color: refLineColor, width: 1, dash: "dot" as const }, fixedColor: refLineColor,
          hoverinfo: "skip" as const,
        },
      ];
      plots.push({
        name:   "powerlaw",
        data:   applyStyleToData(rawData3, style),
        layout: applyStyleToLayout({
          ...LAYOUT_BASE, height: 240,
          xaxis: { ...LAYOUT_BASE.xaxis, title: { text: "E (V)", font: { color: "#74C69D" } } },
          yaxis: { ...LAYOUT_BASE.yaxis, title: { text: "b",     font: { color: "#74C69D" } }, range: [0, 1.2] },
          margin: { t: 20, r: 10, b: 48, l: 60 },
        }, style),
      });
    }

    return plots;
  }, [bValueData, bProfileData, style]); // eslint-disable-line react-hooks/exhaustive-deps

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

          {/* Trasatti plot: C vs √ν */}
          {srPlots[0] && (
            <ClampedPlot data={srPlots[0].data} layout={srPlots[0].layout}
              resetKey={`scan-rate-cap-${srRunKey}`}
              config={{ responsive: true, displayModeBar: "hover", displaylogo: false }}
              style={{ width: "100%", height: "220px" }} useResizeHandler legendStyle={style} />
          )}

          {/* Power-law (Lindström) plot: b(E) resolved across the whole sweep */}
          {bProfileLoading && <p className="text-[11px] text-panel-muted">Computing b(E) profile…</p>}
          {srPlots[1] && (
            <ClampedPlot data={srPlots[1].data} layout={srPlots[1].layout}
              resetKey={`scan-rate-powerlaw-${srRunKey}`}
              config={{ responsive: true, displayModeBar: "hover", displaylogo: false }}
              style={{ width: "100%", height: "240px" }} useResizeHandler legendStyle={style} />
          )}
          {srRunKey > 0 && !bProfileLoading && validProfileEntries.length < 3 && (
            <p className="text-[11px] text-panel-muted italic">
              Power-law (Lindström) b(E) needs at least 3 scan-rate entries with loaded curve data.
            </p>
          )}

          {bValueData.capPoints.length >= 2 && (
            <div className="overflow-x-auto">
              <p className="text-[10px] font-semibold text-panel-muted uppercase tracking-wider px-1 mb-1">Trasatti</p>
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
