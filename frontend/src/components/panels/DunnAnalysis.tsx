import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ParsedFile, DunnResponse } from "../../types";
import { analyzeDunn } from "../../api/client";
import { parseScanRateMvs, LAYOUT_BASE } from "../../utils/plotUtils";
import { useFileLabels } from "../../context/FileLabelContext";
import { useStyle } from "../../context/StyleContext";
import { applyStyleToData, applyStyleToLayout } from "../../utils/applyStyle";
import { PALETTES } from "../../styles/styleTypes";
import { decimateRows } from "../../utils/exportUtils";
import ClampedPlot from "../ClampedPlot";

export interface DunnPlotExport {
  data:   Plotly.Data[];
  layout: Partial<Plotly.Layout>;
}

interface SrEntry {
  fileId:     string;
  cycleIndex: number;
}

function fmt(v: number | null | undefined, dp = 1): string {
  return v != null && Number.isFinite(v) ? v.toFixed(dp) : "—";
}

const thCls = "px-2 py-1 text-left text-[10px] font-semibold text-panel-muted uppercase tracking-wider border-b border-panel-border whitespace-nowrap";
const tdCls = "px-2 py-1 text-[11px] text-panel-text tabular-nums";
const selectCls = "bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-[10px] text-panel-text truncate max-w-[130px]";

const EXPLAIN_DUNN = `Dunn method (Dunn et al., 2015, ACS Nano): i(V,ν) = k₁(V)·ν + k₂(V)·√ν. The k₁·ν term is the surface-controlled (capacitive/pseudocapacitive) contribution; k₂·√ν is the semi-infinite diffusion-limited (intercalation) contribution. Linear regression is performed at every potential point across all loaded scan rates.`;

interface Props {
  allCvFiles:    ParsedFile[];
  getDunnCsvRef: React.MutableRefObject<() => string>;
  getDunnPlotRef: React.MutableRefObject<() => DunnPlotExport | null>;
  getDunnSummaryRef: React.MutableRefObject<() => string[]>;
}

export default function DunnAnalysis({ allCvFiles, getDunnCsvRef, getDunnPlotRef, getDunnSummaryRef }: Props) {
  const style    = useStyle();
  const { getLabel } = useFileLabels();

  const srFileMap = useMemo(
    () => Object.fromEntries(allCvFiles.map(f => [f.id, f])),
    [allCvFiles],
  );

  const [entries,  setEntries]  = useState<SrEntry[]>([]);
  const [runKey,   setRunKey]   = useState(0);
  const [targetId, setTargetId] = useState<string>("");
  const [showDiff, setShowDiff] = useState(false);

  // Remove stale entries when files are removed
  useEffect(() => {
    const validIds = new Set(allCvFiles.map(f => f.id));
    setEntries(prev => prev.filter(e => validIds.has(e.fileId)));
  }, [allCvFiles]);

  // Keep targetId pointing at a valid entry
  useEffect(() => {
    if (entries.length > 0 && !entries.find(e => e.fileId === targetId)) {
      setTargetId(entries[0].fileId);
    }
  }, [entries, targetId]);

  const validEntries = entries.filter(e => {
    const f  = srFileMap[e.fileId];
    const sr = f ? parseScanRateMvs(f.metadata?.SCANRATE) : null;
    return !!f && sr != null && (f.curves?.length ?? 0) > 0;
  });

  const targetSr = (() => {
    const f  = srFileMap[targetId];
    return f ? (parseScanRateMvs(f.metadata?.SCANRATE) ?? null) : null;
  })();

  const queryEnabled = runKey > 0 && validEntries.length >= 3 && targetSr != null;

  const queryBody = useMemo(() => {
    if (!queryEnabled) return null;
    return {
      entries: validEntries.map(e => {
        const f     = srFileMap[e.fileId];
        const curve = f!.curves![e.cycleIndex - 1];
        const sr    = parseScanRateMvs(f!.metadata?.SCANRATE)!;
        return { vf: curve.vf, im: curve.im, scan_rate_mv: sr };
      }),
      target_scan_rate_mv: targetSr!,
    };
    // runKey intentional — gates re-computation
  }, [runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, isLoading, isError } = useQuery<DunnResponse>({
    queryKey: ["dunn", runKey],
    queryFn:  () => analyzeDunn(queryBody!),
    enabled:  queryEnabled && queryBody != null,
  });

  // Detect duplicate scan rates
  const duplicates = useMemo(() => {
    const map = new Map<number, string[]>();
    entries.forEach(e => {
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
  }, [entries, srFileMap, getLabel]);

  function buildDunnCsv(): string {
    if (!data) return "";
    const lines: string[] = [
      `# Dunn Analysis — target ν = ${targetSr} mV/s`,
      `# ${EXPLAIN_DUNN.replace(/"/g, "'")}`,
      `Section,Metric,Value,Unit`,
      `Dunn,Capacitive fraction,${fmt(data.cap_fraction * 100, 1)},%`,
      `Dunn,Diffusion fraction,${fmt(data.diff_fraction * 100, 1)},%`,
      `Dunn,Regression R² (mean),${fmt(data.r2_mean, 3)},—`,
      ``,
      `V (V),i_total (mA),i_cap (mA),i_diff (mA)`,
      ...data.voltages.map((v, i) =>
        `${v.toFixed(5)},${data.i_total[i].toFixed(5)},${data.i_cap[i].toFixed(5)},${data.i_diff[i].toFixed(5)}`
      ),
    ];
    return lines.join("\n");
  }

  getDunnCsvRef.current = buildDunnCsv;

  function buildDunnSummary(): string[] {
    if (!data) return [];
    const lines: string[] = [
      `Target scan rate: ${targetSr} mV/s`,
      `Capacitive fraction: ${fmt(data.cap_fraction * 100, 1)}%`,
      `Diffusion fraction: ${fmt(data.diff_fraction * 100, 1)}%`,
      `Regression R² (mean): ${fmt(data.r2_mean, 3)}`,
      `[${EXPLAIN_DUNN}]`,
      "",
    ];
    const decompRows = data.voltages.map((v, i) =>
      `${v.toFixed(5)},${data.i_total[i].toFixed(5)},${data.i_cap[i].toFixed(5)},${data.i_diff[i].toFixed(5)}`
    );
    const { rows: decompSample, note: decompNote } = decimateRows(decompRows);
    lines.push(`Decomposition (${decompNote}):`, "V (V),i_total (mA),i_cap (mA),i_diff (mA)", ...decompSample);
    return lines;
  }

  getDunnSummaryRef.current = buildDunnSummary;

  const dunnPlot = useMemo((): DunnPlotExport | null => {
    if (!data) return null;
    const palette = style.customPalette ?? PALETTES[style.colorScheme] ?? PALETTES["Forest"];
    const c0 = palette[0] ?? "#45d0bf";
    const c1 = palette[1] ?? "#fb923c";
    const rawData: Plotly.Data[] = [
      {
        x: data.voltages, y: data.i_cap,
        type: "scatter" as const, mode: "lines" as const,
        name: `Capacitive (${(data.cap_fraction * 100).toFixed(1)}%)`,
        fill: "tozeroy" as const, fillcolor: `${c0}40`,
        line: { color: c0, width: 1.5 },
      },
      ...(showDiff ? [{
        x: data.voltages, y: data.i_diff,
        type: "scatter" as const, mode: "lines" as const,
        name: `Diffusion (${(data.diff_fraction * 100).toFixed(1)}%)`,
        fill: "tozeroy" as const, fillcolor: `${c1}33`,
        line: { color: c1, width: 1, dash: "dot" as const },
      }] : []),
      {
        x: data.voltages, y: data.i_total,
        type: "scatter" as const, mode: "lines" as const,
        name: "Total CV",
        line: { color: "rgba(180,180,180,0.9)", width: 2 },
      },
    ];
    return {
      data:   applyStyleToData(rawData, style),
      layout: applyStyleToLayout({
        ...LAYOUT_BASE, height: 280,
        xaxis: { ...LAYOUT_BASE.xaxis, title: { text: "E (V)", font: { color: "#74C69D" } } },
        yaxis: { ...LAYOUT_BASE.yaxis, title: { text: "i (mA)", font: { color: "#74C69D" } } },
        margin: { t: 20, r: 10, b: 48, l: 60 },
      }, style),
    };
  }, [data, showDiff, style]); // eslint-disable-line react-hooks/exhaustive-deps

  getDunnPlotRef.current = () => dunnPlot;

  return (
    <div className="flex flex-col gap-2 px-3 py-2">

      {/* Info / guard messages */}
      {allCvFiles.length < 3 && (
        <p className="text-[11px] text-amber-500 bg-amber-400/10 border border-amber-400/40 rounded px-2 py-1.5">
          Load CV files at at least three different scan rates to enable this analysis —
          with only two, the two-parameter fit is exact and the decomposition is not meaningful.
        </p>
      )}

      {entries.length === 0 && allCvFiles.length >= 3 && (
        <p className="text-[11px] text-panel-muted italic">
          Add files measured at different scan rates using the dropdown below.
        </p>
      )}

      {duplicates.map((msg, i) => (
        <p key={i} className="text-[11px] text-orange-500 bg-orange-400/10 border border-orange-400/40 rounded px-2 py-1">
          ⚠ {msg}
        </p>
      ))}

      {/* Entry table */}
      {entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead><tr className="bg-panel-header">
              <th className={thCls}>File</th>
              <th className={thCls}>ν (mV/s)</th>
              <th className={thCls}>Cycle</th>
              <th className={thCls}></th>
            </tr></thead>
            <tbody>
              {entries.map((entry, i) => {
                const f        = srFileMap[entry.fileId];
                const sr       = f ? parseScanRateMvs(f.metadata?.SCANRATE) : null;
                const maxCycle = f?.curves?.length ?? 1;
                return (
                  <tr key={i} className={i % 2 === 0 ? "bg-panel-bg" : "bg-panel-bgalt"}>
                    <td className="px-2 py-1">
                      <select
                        value={entry.fileId}
                        onChange={e => setEntries(prev => prev.map((en, j) =>
                          j === i ? { fileId: e.target.value, cycleIndex: 1 } : en
                        ))}
                        className={selectCls}
                      >
                        {allCvFiles.map(f2 => (
                          <option key={f2.id} value={f2.id}>{getLabel(f2.id, f2.name)}</option>
                        ))}
                      </select>
                    </td>
                    <td className={tdCls}>
                      {sr != null ? sr : <span className="text-panel-muted">— no scan rate in metadata</span>}
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number" value={entry.cycleIndex} min={1} max={maxCycle}
                        onChange={e => setEntries(prev => prev.map((en, j) =>
                          j === i ? { ...en, cycleIndex: Math.min(Math.max(1, Number(e.target.value)), maxCycle) } : en
                        ))}
                        className="w-10 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-[10px] text-panel-text"
                      />
                      <span className="text-[10px] text-panel-muted ml-1">/ {maxCycle}</span>
                    </td>
                    <td className="px-2 py-1">
                      <button
                        onClick={() => setEntries(prev => prev.filter((_, j) => j !== i))}
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

      {/* Add file dropdown */}
      {allCvFiles.some(f => !entries.find(e => e.fileId === f.id)) && (
        <select
          value=""
          onChange={e => {
            if (!e.target.value) return;
            const f = srFileMap[e.target.value];
            const defaultCycle = Math.min(3, f?.curves?.length ?? f?.total_curves ?? 1);
            setEntries(prev => [...prev, { fileId: e.target.value, cycleIndex: defaultCycle }]);
          }}
          className="text-[10px] bg-panel-bg border border-panel-border rounded px-2 py-1 text-panel-muted self-start"
        >
          <option value="">+ Add file…</option>
          {allCvFiles
            .filter(f => !entries.find(e => e.fileId === f.id))
            .map(f => <option key={f.id} value={f.id}>{getLabel(f.id, f.name)}</option>)
          }
        </select>
      )}

      {/* Target scan rate selector */}
      {entries.length >= 2 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-panel-muted">Display decomposition at:</span>
          <select
            value={targetId}
            onChange={e => setTargetId(e.target.value)}
            className={selectCls}
          >
            {entries.map(entry => {
              const f  = srFileMap[entry.fileId];
              const sr = f ? parseScanRateMvs(f.metadata?.SCANRATE) : null;
              return (
                <option key={entry.fileId} value={entry.fileId}>
                  {sr != null ? `${sr} mV/s` : getLabel(entry.fileId, f?.name ?? entry.fileId)}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* Run button */}
      <button
        onClick={() => setRunKey(k => k + 1)}
        disabled={validEntries.length < 3}
        className="self-start text-[11px] bg-forest-600 hover:bg-forest-700 text-white rounded px-3 py-1 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
      >
        {isLoading ? "Running…" : runKey > 0 ? "Re-run" : "Run analysis"}
      </button>

      {isLoading && <p className="text-[11px] text-panel-muted">Analysing…</p>}
      {isError   && <p className="text-[11px] text-red-500">Analysis failed — check scan rates and voltage windows.</p>}

      {/* Results */}
      {data && (
        <div className="flex flex-col gap-3 pt-1">

          {/* Summary stats */}
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Capacitive",  value: `${fmt(data.cap_fraction  * 100, 1)} %`, color: "text-teal-400" },
              { label: "Diffusion",   value: `${fmt(data.diff_fraction * 100, 1)} %`, color: "text-orange-400" },
              { label: "R² (mean)",   value: fmt(data.r2_mean, 3),                    color: "text-panel-text" },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex flex-col items-center bg-panel-header border border-panel-border rounded px-3 py-1.5 min-w-[80px]">
                <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
                <span className="text-[9px] text-panel-muted uppercase tracking-wider mt-0.5">{label}</span>
              </div>
            ))}
            <div className="flex flex-col justify-center ml-1">
              <span className="text-[10px] text-panel-muted">at {targetSr} mV/s</span>
            </div>
          </div>

          {/* Toggle: show diffusion fill */}
          <label className="flex items-center gap-1.5 text-[10px] text-panel-muted cursor-pointer self-start">
            <input
              type="checkbox"
              checked={showDiff}
              onChange={e => setShowDiff(e.target.checked)}
              className="accent-orange-400"
            />
            Also show diffusion fill
          </label>

          {/* Decomposition plot */}
          {dunnPlot && (
            <ClampedPlot
              data={dunnPlot.data}
              layout={dunnPlot.layout}
              resetKey={`dunn-${runKey}-${showDiff ? "diff" : "cap"}`}
              config={{ responsive: true, displayModeBar: "hover", displaylogo: false }}
              style={{ width: "100%", height: "280px" }}
              legendStyle={style}
              useResizeHandler
            />
          )}

          {/* Explanation */}
          <p className="text-[10px] text-panel-muted leading-relaxed border-t border-panel-border pt-2">
            {EXPLAIN_DUNN}
          </p>

        </div>
      )}
    </div>
  );
}
