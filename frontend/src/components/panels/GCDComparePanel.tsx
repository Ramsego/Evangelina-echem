import { useState, useEffect, useRef, useMemo } from "react";
import Plot from "react-plotly.js";
import { Eye, EyeOff } from "lucide-react";
import { ComparisonSession, ParsedFile } from "../../types";
import { useZoom } from "../../hooks/useZoom";
import { useStyle, useStyleContext } from "../../context/StyleContext";
import { useFileLabels } from "../../context/FileLabelContext";
import { applyStyleToData, applyStyleToLayout, resolveLegendFontSize } from "../../utils/applyStyle";
import { useExportContext, CollectResult } from "../../context/ExportContext";
import { exportPlotImage, downloadCsv } from "../../utils/exportUtils";
import { LAYOUT_BASE, axisOverride, computeExtents, shortNames } from "../../utils/plotUtils";
import { useZoomClamp } from "../../hooks/useZoomClamp";
import { useContainerSize } from "../../hooks/useContainerSize";
import AxisInput from "../AxisInput";

const inputCls = "w-16 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400";

interface Props {
  comparison: ComparisonSession;
  files:      ParsedFile[];
}

export default function GCDComparePanel({ comparison, files }: Props) {
  const style    = useStyle();
  const { labels, getLabel, setLabel } = useFileLabels();
  const fileMap  = useMemo(() => Object.fromEntries(files.map(f => [f.id, f])), [files]);

  const [visible, setVisible] = useState<Record<string, boolean>>(
    () => Object.fromEntries(comparison.selections.map(s => [s.fileId, true]))
  );
  const toggleVisible = (fileId: string) =>
    setVisible(prev => ({ ...prev, [fileId]: !prev[fileId] }));

  const [norm,     setNorm]     = useState<"none"|"area"|"mass">("none");
  const [normVal,  setNormVal]  = useState(1.0);
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

  const { register, unregister } = useExportContext();
  const handleExportRef = useRef<(fmt: string) => void>(() => {});
  const collectRef      = useRef<() => CollectResult>(() => ({ filename: "", csv: "", plotData: [], layout: {} }));
  const uiRevKey = `${comparison.id}-${norm}`;
  const { onRelayout: zoomOnRelayout, legendState, hasZoom, getRangeSnapshot } = useZoom(uiRevKey);
  const [plotRef, plotSize] = useContainerSize();
  const { setLegendAutoSize } = useStyleContext();

  useEffect(() => {
    register(comparison.id, fmt => handleExportRef.current(fmt), () => collectRef.current());
    return () => unregister(comparison.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- register/unregister are stable (backed by useRef in ExportProvider); mount-only registration is intentional

  const gcdFiles = useMemo(
    () => comparison.selections.map(sel => fileMap[sel.fileId]).filter((f): f is ParsedFile => !!f?.gcd),
    [comparison.selections, fileMap]
  );

  const yLabel = norm === "area" ? "Specific cap. (mAh/cm²)"
               : norm === "mass" ? "Specific cap. (mAh/g)"
               : "Discharge cap. (mAh)";

  const plotData = useMemo((): Plotly.Data[] => {
    const shortened = shortNames(gcdFiles.map(f => f.name));
    return gcdFiles.map((file, idx) => {
      const gcd    = file.gcd!;
      const disMah = gcd.discharge_caps.map((c: number) => (c / 3600) * 1000);
      const y = norm === "area" ? disMah.map((v: number) => v / normVal)
              : norm === "mass" ? disMah.map((v: number) => v / (normVal / 1000))
              : disMah;
      return {
        x: gcd.cycles, y,
        type: "scatter" as const, mode: "lines+markers" as const,
        name: labels[file.id] ?? shortened[idx],
        line:   { width: 2 },
        marker: { size: 4 },
        visible: visible[file.id] !== false ? true : "legendonly" as const,
      };
    });
  }, [gcdFiles, norm, normVal, visible, labels]);

  const rawLayout = useMemo((): Partial<Plotly.Layout> => ({
    ...LAYOUT_BASE,
    xaxis: { ...LAYOUT_BASE.xaxis, title: { text: xTitleOverride || "Cycle", font: { color: "#74C69D" } }, ...axisOverride(xMin, xMax, xLog) },
    yaxis: { ...LAYOUT_BASE.yaxis, title: { text: yTitleOverride || yLabel,   font: { color: "#74C69D" } }, ...axisOverride(yMin, yMax, yLog) },
  }), [xTitleOverride, xMin, xMax, xLog, yTitleOverride, yLabel, yMin, yMax, yLog]);
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
    const visibleFiles = gcdFiles.filter(f => visible[f.id] !== false);
    const headers: string[] = [];
    const units:   string[] = [];
    visibleFiles.forEach(f => {
      const n = getLabel(f.id, f.name);
      headers.push(`Cycle_${n}`, `DisMah_${n}`);
      units.push("", "mAh");
    });
    const maxLen = Math.max(0, ...visibleFiles.map(f => f.gcd!.cycles.length));
    const rows: string[] = [];
    for (let i = 0; i < maxLen; i++) {
      const row = visibleFiles.flatMap(f => {
        const gcd    = f.gcd!;
        const disMah = gcd.discharge_caps[i] != null
          ? ((gcd.discharge_caps[i] / 3600) * 1000).toFixed(6)
          : "";
        return [gcd.cycles[i]?.toString() ?? "", disMah];
      });
      rows.push(row.join(","));
    }
    return [headers.join(","), units.join(","), ...rows].join("\n");
  }

  handleExportRef.current = (fmt: string) => {
    if (fmt === "csv") { downloadCsv(buildCsv(), comparison.name); return; }
    exportPlotImage(styledData, layout, comparison.name, fmt as "png" | "svg");
  };
  collectRef.current = () => ({
    filename: comparison.name,
    csv:      buildCsv(),
    plotData: styledData,
    layout,
  });

  function handleRestyle(data: Record<string, unknown>[], indices?: number[]) {
    if (!data?.[0] || !("name" in data[0]) || !indices) return;
    indices.forEach(traceIdx => {
      const file = gcdFiles[traceIdx];
      if (!file) return;
      let newName = (Array.isArray(data[0].name) ? data[0].name[0] : data[0].name) as string;
      newName = newName.trim();
      if (newName) setLabel(file.id, newName);
    });
  }

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex flex-col gap-0.5 px-3 py-1.5 bg-panel-header border-b border-panel-border text-xs text-panel-text shrink-0">

        {/* Per-file visibility row */}
        <div className="flex flex-wrap items-center gap-2">
          {comparison.selections.map(sel => {
            const file = fileMap[sel.fileId];
            if (!file?.gcd) return null;
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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 border-t border-panel-border">
          <select value={norm} onChange={e => setNorm(e.target.value as "none"|"area"|"mass")}
                  className="bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400">
            <option value="none">No normalisation</option>
            <option value="area">By area (cm²)</option>
            <option value="mass">By mass (mg)</option>
          </select>
          {norm !== "none" && (
            <input type="number" value={normVal} min={0.001} step={0.01}
                   onChange={e => setNormVal(Number(e.target.value))}
                   className={inputCls} />
          )}

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
                <input type="text" placeholder="Cycle" value={xTitleOverride} onChange={e => setXTitleOverride(e.target.value)}
                       className="flex-1 min-w-0 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400 text-[10px]" />
                <span className="text-[10px] font-semibold text-panel-muted shrink-0">Y label</span>
                <input type="text" placeholder={yLabel} value={yTitleOverride} onChange={e => setYTitleOverride(e.target.value)}
                       className="flex-1 min-w-0 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400 text-[10px]" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Plot */}
      <div ref={plotRef} className="relative flex-1 min-h-0">
        <div className="absolute inset-0">
          <Plot key={plotKey} data={styledData} layout={layout} onRelayout={onRelayout as never} onRestyle={handleRestyle as never}
                config={{ responsive: true, displayModeBar: "hover", displaylogo: false, scrollZoom: true, edits: { legendPosition: true, legendText: true } }}
                style={{ width: "100%", height: "100%" }} useResizeHandler />
        </div>
      </div>
    </div>
  );
}
