import { useState, useEffect, useRef, useMemo } from "react";
import Plot from "react-plotly.js";
import { Eye, EyeOff } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { analyzeEIS } from "../../api/client";
import { ComparisonSession, ParsedFile } from "../../types";
import { useZoom } from "../../hooks/useZoom";
import { useStyle, useStyleContext } from "../../context/StyleContext";
import { useFileLabels } from "../../context/FileLabelContext";
import { applyStyleToData, applyStyleToLayout, resolveLegendFontSize } from "../../utils/applyStyle";
import { useExportContext, CollectResult, ExportSheet } from "../../context/ExportContext";
import { exportPlotImage, downloadCsv, decimateRows, PanelSummary, SummarySection } from "../../utils/exportUtils";
import { LAYOUT_BASE, axisOverride, computeExtents, shortNames } from "../../utils/plotUtils";
import { useZoomClamp } from "../../hooks/useZoomClamp";
import { useContainerSize } from "../../hooks/useContainerSize";
import AxisInput from "../AxisInput";

const inputCls = "w-16 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400";

const MODEL_LABEL: Record<string, string> = {
  randles:             "Randles",
  randles_cpe:         "R-CPE",
  randles_cpe_warburg: "R-CPE-W",
};

function fmtPm(v: number | null, e: number | null): string {
  if (v == null) return "—";
  return `${Number(v.toPrecision(3))}${e != null ? ` ± ${Number(e.toPrecision(2))}` : ""}`;
}

type View = "nyquist" | "bode";

interface Props {
  comparison: ComparisonSession;
  files:      ParsedFile[];
}

export default function EISComparePanel({ comparison, files }: Props) {
  const style    = useStyle();
  const { labels, getLabel, setLabel } = useFileLabels();
  const fileMap  = useMemo(() => Object.fromEntries(files.map(f => [f.id, f])), [files]);

  const [visible, setVisible] = useState<Record<string, boolean>>(
    () => Object.fromEntries(comparison.selections.map(s => [s.fileId, true]))
  );
  const toggleVisible = (fileId: string) =>
    setVisible(prev => ({ ...prev, [fileId]: !prev[fileId] }));

  const [view,     setView]     = useState<View>("nyquist");
  const [axesOpen,       setAxesOpen]       = useState(false);
  const [dragmode,       setDragmode]       = useState<'zoom'|'pan'>('zoom');
  const [xMin,           setXMin]           = useState("");
  const [xMax,           setXMax]           = useState("");
  const [yMin,           setYMin]           = useState("");
  const [yMax,           setYMax]           = useState("");
  const [xLog,           setXLog]           = useState(false);
  const [yLog,           setYLog]           = useState(false);
  const [xTitleOverride, setXTitleOverride] = useState("");
  const [yTitleOverride, setYTitleOverride] = useState("");

  // Reset axes and set sensible log defaults when switching view
  useEffect(() => {
    setXMin(""); setXMax(""); setYMin(""); setYMax("");
    setXLog(view === "bode");
    setYLog(view === "bode");
    setXTitleOverride(""); setYTitleOverride("");
  }, [view]);

  const { register, unregister } = useExportContext();
  const handleExportRef = useRef<(fmt: string, name?: string) => void>(() => {});
  const collectRef      = useRef<() => CollectResult>(() => ({ filename: "", csv: "", plotData: [], layout: {} }));
  const sheetsRef       = useRef<() => ExportSheet[]>(() => []);
  const uiRevKey = `${comparison.id}-${view}`;
  const { onRelayout: zoomOnRelayout, legendState, hasZoom, getRangeSnapshot } = useZoom(uiRevKey);
  const [plotRef, plotSize] = useContainerSize();
  const { setLegendAutoSize } = useStyleContext();

  useEffect(() => {
    register(comparison.id, (fmt, name) => handleExportRef.current(fmt, name), () => collectRef.current(), () => sheetsRef.current());
    return () => unregister(comparison.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- register/unregister are stable (backed by useRef in ExportProvider); mount-only registration is intentional

  const eisFiles = useMemo(
    () => comparison.selections.map(sel => fileMap[sel.fileId]).filter((f): f is ParsedFile => !!f?.eis),
    [comparison.selections, fileMap]
  );

  const [showFit, setShowFit] = useState(false);
  // Query key matches EISPanel's auto-model key so the cache is shared
  const fitQueries = useQueries({
    queries: eisFiles.map(f => ({
      queryKey:  ["eis", f.id, "auto"],
      queryFn:   () => analyzeEIS({ eis: f.eis!, model: "auto" }),
      enabled:   showFit,
      staleTime: Infinity,
    })),
  });
  const fitsKey = fitQueries.map(q => q.dataUpdatedAt).join(",");

  // Build traces
  const { plotData, rawLayout } = useMemo((): { plotData: Plotly.Data[]; rawLayout: Partial<Plotly.Layout> } => {
    const data: Plotly.Data[] = [];
    const shortened = shortNames(eisFiles.map(f => f.name));
    if (view === "nyquist") {
      eisFiles.forEach((file, idx) => {
        const eis  = file.eis!;
        const negZ = eis.zimag.map(v => -v);
        data.push({
          x: eis.zreal, y: negZ,
          type: "scatter", mode: "lines+markers",
          name: labels[file.id] ?? shortened[idx],
          marker: { size: 5 },
          line:   { width: 1.5 },
          visible: visible[file.id] !== false ? true : "legendonly" as const,
        });
      });
      if (showFit) {
        eisFiles.forEach((file, idx) => {
          const fit = fitQueries[idx]?.data?.circuit_fit;
          if (!fit || visible[file.id] === false) return;
          data.push({
            x: fit.fit_zreal,
            y: fit.fit_zimag.map(v => -v),
            type: "scatter", mode: "lines",
            name: `fit-${idx}`,
            showlegend: false,
            line: { width: 1.5, dash: "dash" },
          });
        });
      }
    } else {
      eisFiles.forEach((file, idx) => {
        const eis = file.eis!;
        data.push({
          x: eis.freq, y: eis.zmod,
          type: "scatter", mode: "lines+markers",
          name: `|Z| — ${labels[file.id] ?? shortened[idx]}`,
          marker: { size: 5 },
          line:   { width: 1.5 },
          visible: visible[file.id] !== false ? true : "legendonly" as const,
        });
      });
    }
    const rawLay: Partial<Plotly.Layout> = view === "nyquist"
      ? {
          ...LAYOUT_BASE,
          xaxis: { ...LAYOUT_BASE.xaxis, title: { text: xTitleOverride || "Z′ (Ω)",  font: { color: "#74C69D" } }, scaleanchor: "y" as const, scaleratio: 1, constrain: "domain" as const, ...axisOverride(xMin, xMax, xLog) },
          yaxis: { ...LAYOUT_BASE.yaxis, title: { text: yTitleOverride || "−Z″ (Ω)", font: { color: "#74C69D" } }, constrain: "domain" as const, ...axisOverride(yMin, yMax, yLog) },
        }
      : {
          ...LAYOUT_BASE,
          xaxis: { ...LAYOUT_BASE.xaxis, title: { text: xTitleOverride || "Frequency (Hz)", font: { color: "#74C69D" } }, ...axisOverride(xMin, xMax, xLog) },
          yaxis: { ...LAYOUT_BASE.yaxis, title: { text: yTitleOverride || "|Z| (Ω)",        font: { color: "#74C69D" } }, ...axisOverride(yMin, yMax, yLog) },
        };
    return { plotData: data, rawLayout: rawLay };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fitQueries is a new array each render; fitsKey captures when any fit result actually changes
  }, [eisFiles, view, xMin, xMax, xLog, yMin, yMax, yLog, xTitleOverride, yTitleOverride, visible, labels, showFit, fitsKey]);

  const styledData   = useMemo(() => applyStyleToData(plotData, style),    [plotData, style]);
  const extents = useMemo(() => { const e = computeExtents(styledData); return e ? { ...e, xIsLog: xLog, yIsLog: yLog } : null; }, [styledData, xLog, yLog]);
  const { onRelayout, clamp, uirevision, plotKey } = useZoomClamp(extents, zoomOnRelayout, uiRevKey);
  const styledLayout = useMemo(() => applyStyleToLayout(rawLayout, style), [rawLayout, style]);
  const legendFontSize = resolveLegendFontSize(style, plotSize);
  useEffect(() => { setLegendAutoSize(comparison.id, legendFontSize); }, [comparison.id, legendFontSize, setLegendAutoSize]);
  const layout       = useMemo((): Partial<Plotly.Layout> => ({
    ...styledLayout,
    uirevision,
    dragmode,
    legend: {
      ...(styledLayout.legend as object ?? {}),
      font: { ...(((styledLayout.legend as { font?: object } | undefined)?.font) ?? {}), size: legendFontSize },
      ...(legendState.x != null ? { x: legendState.x, y: legendState.y } : {}),
    },
    ...(clamp.x && { xaxis: { ...(styledLayout.xaxis ?? {}), autorange: false as const, range: clamp.x } }),
    ...(clamp.y && { yaxis: { ...(styledLayout.yaxis ?? {}), autorange: false as const, range: clamp.y } }),
  }), [styledLayout, uirevision, dragmode, legendFontSize, legendState, clamp]);

  function buildCsv(): string {
    const visibleFiles = eisFiles.filter(f => visible[f.id] !== false);
    const headers: string[] = [];
    const units:   string[] = [];
    let maxLen = 0;

    if (view === "nyquist") {
      visibleFiles.forEach(f => {
        const n = getLabel(f.id, f.name);
        headers.push(`Zreal_${n}`, `NegZimag_${n}`);
        units.push("Ohm", "Ohm");
        maxLen = Math.max(maxLen, f.eis!.zreal.length);
      });
      const rows: string[] = [];
      for (let i = 0; i < maxLen; i++) {
        const row = visibleFiles.flatMap(f => {
          const eis = f.eis!;
          return [
            eis.zreal[i]?.toFixed(6) ?? "",
            eis.zimag[i] != null ? (-eis.zimag[i]).toFixed(6) : "",
          ];
        });
        rows.push(row.join(","));
      }
      return [headers.join(","), units.join(","), ...rows].join("\n");
    } else {
      visibleFiles.forEach(f => {
        const n = getLabel(f.id, f.name);
        headers.push(`Freq_${n}`, `Zmod_${n}`);
        units.push("Hz", "Ohm");
        maxLen = Math.max(maxLen, f.eis!.freq.length);
      });
      const rows: string[] = [];
      for (let i = 0; i < maxLen; i++) {
        const row = visibleFiles.flatMap(f => {
          const eis = f.eis!;
          return [
            eis.freq[i]?.toExponential(4) ?? "",
            eis.zmod[i]?.toFixed(6) ?? "",
          ];
        });
        rows.push(row.join(","));
      }
      return [headers.join(","), units.join(","), ...rows].join("\n");
    }
  }

  function buildSheets(): ExportSheet[] {
    const visibleFiles = eisFiles.filter(f => visible[f.id] !== false);
    const headers: string[] = [];
    const units:   string[] = [];
    let maxLen = 0;
    const nyq = view === "nyquist";
    visibleFiles.forEach(f => {
      const n = getLabel(f.id, f.name);
      if (nyq) { headers.push(`Zreal_${n}`, `NegZimag_${n}`); units.push("Ohm", "Ohm"); maxLen = Math.max(maxLen, f.eis!.zreal.length); }
      else     { headers.push(`Freq_${n}`,  `Zmod_${n}`);     units.push("Hz", "Ohm");   maxLen = Math.max(maxLen, f.eis!.freq.length); }
    });
    const rows: (number | null)[][] = [];
    for (let i = 0; i < maxLen; i++) {
      const row = visibleFiles.flatMap(f => {
        const eis = f.eis!;
        return nyq
          ? [eis.zreal[i] ?? null, eis.zimag[i] != null ? -eis.zimag[i] : null]
          : [eis.freq[i] ?? null,  eis.zmod[i] ?? null];
      });
      rows.push(row);
    }
    return [{ name: "Plotted", headers, units, rows }];
  }

  function buildSummary(): PanelSummary {
    const visibleFiles = eisFiles.filter(f => visible[f.id] !== false);
    const filesCompared: string[] = [];
    eisFiles.forEach(file => {
      const label = getLabel(file.id, file.name);
      if (visible[file.id] === false) {
        filesCompared.push(`- ${label}: hidden (excluded from data table)`);
        return;
      }
      const eis = file.eis!;
      const fmin = Math.min(...eis.freq);
      const fmax = Math.max(...eis.freq);
      filesCompared.push(`- ${label}: ${eis.freq.length} points, ${fmin.toExponential(2)}–${fmax.toExponential(2)} Hz`);
    });

    const settings = [`View: ${view === "nyquist" ? "Nyquist" : "Bode (|Z| vs frequency)"}`];

    const fitsLines: string[] = [];
    if (showFit) {
      eisFiles.forEach((file, idx) => {
        if (visible[file.id] === false) return;
        const label = getLabel(file.id, file.name);
        const q = fitQueries[idx];
        const fit = q?.data?.circuit_fit;
        if (q?.isLoading) {
          fitsLines.push(`- ${label}: fit pending`);
        } else if (!fit) {
          fitsLines.push(`- ${label}: fit failed`);
        } else {
          const cPart = fit.C_dl_uF != null
            ? `C_dl = ${fmtPm(fit.C_dl_uF, fit.C_dl_uF_err)} µF`
            : `Q = ${fmtPm(fit.Q, fit.Q_err)}, α = ${fmtPm(fit.alpha, fit.alpha_err)}`;
          const sigmaPart = fit.sigma != null ? `, σ = ${fmtPm(fit.sigma, fit.sigma_err)} Ω·s⁻½` : "";
          fitsLines.push(`- ${label}: model ${MODEL_LABEL[fit.model] ?? fit.model}, R_s = ${fmtPm(fit.R_s, fit.R_s_err)} Ω, R_ct = ${fmtPm(fit.R_ct, fit.R_ct_err)} Ω, ${cPart}${sigmaPart}`);
        }
      });
    }

    const [header, units, ...rows] = buildCsv().split("\n");
    const { rows: dataSample, note: dataNote } = decimateRows(rows);

    const sections: SummarySection[] = [
      { title: "Files compared", lines: filesCompared },
      { title: "Settings", lines: settings },
    ];
    if (showFit) sections.push({ title: "Equivalent-circuit fits", lines: fitsLines });
    sections.push({ title: "Warnings", lines: ["(none)"] });
    sections.push({ title: `Data table (${dataNote})`, lines: [header, units, ...dataSample] });

    return {
      etypeLabel: `EIS comparison (${visibleFiles.length} files)`,
      sections,
      llmInstructions: `Do not make assumptions about the experimental setup. This is an overlay comparison of\n${visibleFiles.length} electrochemical impedance spectroscopy files. First ask the user for any missing\ninformation that could materially affect interpretation (what distinguishes the samples,\nworking electrode, electrolyte, DC bias, AC amplitude, temperature, experimental\nobjective). Once sufficient context has been provided, compare the files quantitatively,\ndescribe where they differ, explain any uncertainty, list possible explanations for\nanomalies, and suggest follow-up experiments to distinguish between them.`,
    };
  }

  handleExportRef.current = (fmt: string, name?: string) => {
    const stem = name ?? comparison.name;
    if (fmt === "csv") { downloadCsv(buildCsv(), stem); return; }
    exportPlotImage(styledData, layout, stem, fmt as "png" | "svg", style.exportShape);
  };
  sheetsRef.current = buildSheets;
  collectRef.current = () => ({
    filename: comparison.name,
    csv:      buildCsv(),
    summary:  buildSummary(),
    plotData: styledData,
    layout,
  });

  function handleRestyle(data: Record<string, unknown>[], indices?: number[]) {
    if (!data?.[0] || !("name" in data[0]) || !indices) return;
    indices.forEach(traceIdx => {
      const file = eisFiles[traceIdx];
      if (!file) return;
      let newName = (Array.isArray(data[0].name) ? data[0].name[0] : data[0].name) as string;
      newName = newName.replace(/^\|Z\| — /, "").trim();
      if (newName) setLabel(file.id, newName);
    });
  }

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 bg-panel-header border-b border-panel-border text-xs text-panel-text shrink-0">

        {/* Per-file visibility row */}
        <div className="w-full flex flex-wrap items-center gap-2">
          {comparison.selections.map(sel => {
            const file = fileMap[sel.fileId];
            if (!file?.eis) return null;
            const isVisible = visible[sel.fileId] !== false;
            return (
              <div key={sel.fileId} className="flex items-center gap-1">
                <button onClick={() => toggleVisible(sel.fileId)}
                        className={`transition-colors cursor-pointer ${isVisible ? "text-forest-500 hover:text-forest-300" : "text-panel-muted hover:text-panel-text"}`}
                        title={isVisible ? "Hide trace" : "Show trace"}>
                  {isVisible ? <Eye size={11} /> : <EyeOff size={11} />}
                </button>
                <span className={`text-[10px] rounded px-1.5 py-0.5 truncate max-w-[100px] transition-colors ${isVisible ? "bg-forest-800 text-forest-300" : "bg-panel-bg text-panel-muted"}`}>
                  {getLabel(file.id, file.name)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex rounded overflow-hidden border border-panel-border">
          {(["nyquist", "bode"] as View[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2 py-0.5 text-xs transition-colors ${view === v ? "bg-forest-600 text-white" : "text-panel-text hover:bg-panel-bg"}`}>
              {v === "nyquist" ? "Nyquist" : "Bode (|Z|)"}
            </button>
          ))}
        </div>

        <button onClick={() => setShowFit(s => !s)}
                title="Fit equivalent circuits (auto model selection) and compare parameters"
                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${showFit ? "bg-forest-600 text-white border-forest-600" : "border-panel-border text-panel-muted hover:bg-panel-bg"}`}>
          Fit
        </button>

        <div className="flex rounded overflow-hidden border border-panel-border shrink-0">
          <button onClick={() => setDragmode('zoom')} title="Box zoom"
            className={`px-2 py-0.5 text-[10px] transition-colors ${dragmode === 'zoom' ? 'bg-forest-600 text-white' : 'text-panel-muted hover:bg-panel-bg'}`}>
            Zoom
          </button>
          <button onClick={() => setDragmode('pan')} title="Drag to pan"
            className={`px-2 py-0.5 text-[10px] transition-colors ${dragmode === 'pan' ? 'bg-forest-600 text-white' : 'text-panel-muted hover:bg-panel-bg'}`}>
            Pan
          </button>
        </div>

        <button onClick={() => setAxesOpen(o => !o)}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${axesOpen ? "bg-forest-600 border-forest-600 text-white" : "border-panel-border text-panel-muted hover:text-panel-text"}`}>
          Axes {axesOpen ? "▴" : "▾"}
        </button>

        {axesOpen && (
          <div className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 border-t border-panel-border">
            <span className="font-semibold text-panel-muted">X</span>
            <AxisInput value={xMin} onChange={setXMin} placeholder="min" className={inputCls} />
            <span className="text-panel-muted">–</span>
            <AxisInput value={xMax} onChange={setXMax} placeholder="max" className={inputCls} />
            <label className="flex items-center gap-1 cursor-pointer text-panel-muted">
              <input type="checkbox" checked={xLog} onChange={e => setXLog(e.target.checked)} className="accent-forest-400" /> log
            </label>
            <span className="text-panel-muted px-1">│</span>
            <span className="font-semibold text-panel-muted">Y</span>
            <AxisInput value={yMin} onChange={setYMin} placeholder="min" className={inputCls} />
            <span className="text-panel-muted">–</span>
            <AxisInput value={yMax} onChange={setYMax} placeholder="max" className={inputCls} />
            <label className="flex items-center gap-1 cursor-pointer text-panel-muted">
              <input type="checkbox" checked={yLog} onChange={e => setYLog(e.target.checked)} className="accent-forest-400" /> log
            </label>
            {(xMin || xMax || yMin || yMax) && (
              <button onClick={() => { setXMin(""); setXMax(""); setYMin(""); setYMax(""); }}
                      className="text-[10px] text-panel-muted hover:text-red-500 border border-panel-border rounded px-1.5 py-0.5 transition-colors">
                Reset
              </button>
            )}
            {hasZoom && (
              <button
                onClick={() => {
                  const snap = getRangeSnapshot();
                  if (snap.x) { setXMin(String(+Number(snap.x[0]).toPrecision(5))); setXMax(String(+Number(snap.x[1]).toPrecision(5))); }
                  if (snap.y) { setYMin(String(+Number(snap.y[0]).toPrecision(5))); setYMax(String(+Number(snap.y[1]).toPrecision(5))); }
                }}
                className="text-[10px] text-forest-600 hover:text-forest-400 border border-forest-700/50 rounded px-1.5 py-0.5 transition-colors">
                Lock view
              </button>
            )}
            <div className="w-full flex items-center gap-2 pt-1 border-t border-panel-border">
              <span className="text-[10px] font-semibold text-panel-muted shrink-0">X label</span>
              <input type="text"
                     placeholder={view === "nyquist" ? "Z′ (Ω)" : "Frequency (Hz)"}
                     value={xTitleOverride} onChange={e => setXTitleOverride(e.target.value)}
                     className="flex-1 min-w-0 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400 text-[10px]" />
              <span className="text-[10px] font-semibold text-panel-muted shrink-0">Y label</span>
              <input type="text"
                     placeholder={view === "nyquist" ? "−Z″ (Ω)" : "|Z| (Ω)"}
                     value={yTitleOverride} onChange={e => setYTitleOverride(e.target.value)}
                     className="flex-1 min-w-0 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400 text-[10px]" />
            </div>
          </div>
        )}
      </div>

      {/* Plot */}
      <div ref={plotRef} className="relative flex-1 min-h-0">
        <div className="absolute inset-0">
          <Plot key={plotKey} data={styledData} layout={layout} onRelayout={onRelayout as never} onRestyle={handleRestyle as never}
                config={{ responsive: true, displayModeBar: "hover", displaylogo: false, scrollZoom: true, edits: { legendPosition: true, legendText: true } }}
                style={{ width: "100%", height: "100%" }} useResizeHandler />
        </div>
      </div>

      {/* Fit parameter table */}
      {showFit && (
        <div className="shrink-0 bg-forest-900/50 border-t border-forest-700/30 px-3 py-1.5 overflow-x-auto">
          <table className="text-[10px] text-forest-300 w-full">
            <thead>
              <tr className="text-forest-400 text-left">
                <th className="pr-3 font-medium">File</th>
                <th className="pr-3 font-medium">Model</th>
                <th className="pr-3 font-medium">R_s (Ω)</th>
                <th className="pr-3 font-medium">R_ct (Ω)</th>
                <th className="pr-3 font-medium">Q / C</th>
                <th className="pr-3 font-medium">α</th>
                <th className="font-medium">σ (Ω·s⁻½)</th>
              </tr>
            </thead>
            <tbody>
              {eisFiles.map((file, idx) => {
                if (visible[file.id] === false) return null;
                const q   = fitQueries[idx];
                const fit = q?.data?.circuit_fit;
                return (
                  <tr key={file.id}>
                    <td className="pr-3 py-0.5">
                      <span className="bg-forest-800 rounded px-1.5 py-0.5 inline-block truncate max-w-[120px] align-middle">
                        {getLabel(file.id, file.name)}
                      </span>
                    </td>
                    {q?.isLoading ? (
                      <td colSpan={6} className="text-forest-500">…</td>
                    ) : !fit ? (
                      <td colSpan={6} className="text-forest-600">fit failed</td>
                    ) : (
                      <>
                        <td className="pr-3">{MODEL_LABEL[fit.model] ?? fit.model}</td>
                        <td className="pr-3">{fmtPm(fit.R_s, fit.R_s_err)}</td>
                        <td className="pr-3">{fmtPm(fit.R_ct, fit.R_ct_err)}</td>
                        <td className="pr-3">
                          {fit.C_dl_uF != null
                            ? `${fmtPm(fit.C_dl_uF, fit.C_dl_uF_err)} µF`
                            : fit.Q != null ? fmtPm(fit.Q, fit.Q_err) : "—"}
                        </td>
                        <td className="pr-3">{fit.alpha != null ? fmtPm(fit.alpha, fit.alpha_err) : "—"}</td>
                        <td>{fit.sigma != null ? fmtPm(fit.sigma, fit.sigma_err) : "—"}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
