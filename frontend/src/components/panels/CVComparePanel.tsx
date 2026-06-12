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
import { LAYOUT_BASE, axisOverride, parseScanRateMvs, computeExtents, shortNames } from "../../utils/plotUtils";
import { useZoomClamp } from "../../hooks/useZoomClamp";
import { ELECTRODE_OPTIONS, refOffset, xAxisLabel } from "../../utils/referenceElectrodes";
import { useContainerSize } from "../../hooks/useContainerSize";
import AxisInput from "../AxisInput";

const inputCls = "bg-white border border-gray-300 rounded px-1 py-0.5 text-gray-900";

interface Props {
  comparison: ComparisonSession;
  files:      ParsedFile[];
}

export default function CVComparePanel({ comparison, files }: Props) {
  const style    = useStyle();
  const { labels, getLabel } = useFileLabels();
  const fileMap  = useMemo(() => Object.fromEntries(files.map(f => [f.id, f])), [files]);

  const [visible,  setVisible]  = useState<Record<string, boolean>>(
    () => Object.fromEntries(comparison.selections.map(s => [s.fileId, true]))
  );
  const toggleVisible = (fileId: string) =>
    setVisible(prev => ({ ...prev, [fileId]: !prev[fileId] }));

  // Per-file cycle index (1-based), keyed by fileId so file removal doesn't corrupt indices
  const [cycles,   setCycles]   = useState<Record<string, number>>(
    Object.fromEntries(comparison.selections.map(s => [s.fileId, s.curveIndex]))
  );
  const [refFrom,  setRefFrom]  = useState("As measured");
  const [refTo,    setRefTo]    = useState("As measured");
  const [pH,       setPH]       = useState(7.0);
  const [norm,        setNorm]        = useState<"none"|"area"|"mass"|"scan_rate"|"sqrt_scan_rate"|"bv">("none");
  const [normVal,     setNormVal]     = useState(1.0);
  const [manualRates, setManualRates] = useState<Record<string, number>>({});
  const [bExp,        setBExp]        = useState(0.75);
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

  const vOffset   = refOffset(refFrom, refTo, pH);
  const yLabel    = norm === "area"           ? "Current density (mA/cm²)"
                  : norm === "mass"           ? "Specific current (mA/g)"
                  : norm === "scan_rate"      ? "i/ν (mA·s/V)"
                  : norm === "sqrt_scan_rate" ? "i/√ν (mA·s½/V½)"
                  : norm === "bv"             ? `i/ν^${bExp} (mA·s^b/V^b)`
                  : "Current (mA)";
  const xLabel    = xAxisLabel(refTo);

  const { register, unregister } = useExportContext();
  const handleExportRef = useRef<(fmt: string) => void>(() => {});
  const collectRef      = useRef<() => CollectResult>(() => ({ filename: "", csv: "", plotData: [], layout: {} }));
  const uiRevKey = `${comparison.id}-${norm}-${refFrom}-${refTo}`;
  const { onRelayout: zoomOnRelayout, legendState, hasZoom, getRangeSnapshot } = useZoom(uiRevKey);
  const [plotRef, plotSize] = useContainerSize();
  const { setLegendAutoSize } = useStyleContext();

  useEffect(() => {
    register(comparison.id, fmt => handleExportRef.current(fmt), () => collectRef.current());
    return () => unregister(comparison.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- register/unregister are stable (backed by useRef in ExportProvider); mount-only registration is intentional

  // Build one trace per selected file
  const plotData = useMemo((): Plotly.Data[] => {
    const data: Plotly.Data[] = [];
    const validFiles = comparison.selections
      .map(sel => fileMap[sel.fileId])
      .filter((f): f is ParsedFile => !!f?.curves?.length);
    const shortened = shortNames(validFiles.map(f => f.name));
    const shortenedMap: Record<string, string> = Object.fromEntries(validFiles.map((f, i) => [f.id, shortened[i]]));
    comparison.selections.forEach(sel => {
      const file = fileMap[sel.fileId];
      if (!file?.curves?.length) return;
      const maxIdx  = file.curves.length - 1;
      const cycleN  = Math.min(Math.max(1, cycles[sel.fileId] ?? 1), file.curves.length);
      const curve   = file.curves[Math.min(cycleN - 1, maxIdx)];
      const sr       = parseScanRateMvs(file.metadata?.SCANRATE);
      const srMvs    = sr ?? manualRates[sel.fileId] ?? null;
      const srVs     = srMvs != null ? srMvs / 1000 : null;
      const isSrNorm = norm === "scan_rate" || norm === "sqrt_scan_rate" || norm === "bv";
      if (isSrNorm && srVs == null) return;
      const divisor  = norm === "area"           ? normVal
                     : norm === "mass"           ? normVal / 1000
                     : norm === "scan_rate"      ? srVs!
                     : norm === "sqrt_scan_rate" ? Math.sqrt(srVs!)
                     : norm === "bv"             ? Math.pow(srVs!, bExp)
                     : 1.0;
      data.push({
        x: curve.vf.map(v => v + vOffset),
        y: curve.im.map(v => (v / divisor) * 1000),
        type: "scatter", mode: "lines",
        name: `${labels[file.id] ?? shortenedMap[file.id]} — cycle ${cycleN}${sr != null ? ` (${sr} mV/s)` : ""}`,
        line: { width: 1.8 },
        visible: visible[sel.fileId] !== false ? true : "legendonly" as const,
      });
    });
    return data;
  }, [comparison.selections, fileMap, cycles, vOffset, norm, normVal, manualRates, bExp, visible, labels]);

  const rawLayout = useMemo((): Partial<Plotly.Layout> => ({
    ...LAYOUT_BASE,
    xaxis: { ...LAYOUT_BASE.xaxis, title: { text: xTitleOverride || xLabel, font: { color: "#74C69D" } }, ...axisOverride(xMin, xMax, xLog) },
    yaxis: { ...LAYOUT_BASE.yaxis, title: { text: yTitleOverride || yLabel, font: { color: "#74C69D" } }, ...axisOverride(yMin, yMax, yLog) },
  }), [xTitleOverride, xLabel, xMin, xMax, xLog, yTitleOverride, yLabel, yMin, yMax, yLog]);
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
    const visibleSels = comparison.selections.filter(sel => visible[sel.fileId] !== false);
    const selWithData = visibleSels.flatMap(sel => {
      const file = fileMap[sel.fileId];
      if (!file?.curves?.length) return [];
      const cycleN = Math.min(Math.max(1, cycles[sel.fileId] ?? 1), file.curves.length);
      return [{ file, curve: file.curves[cycleN - 1], cycleN }];
    });

    const headers: string[] = [];
    const units:   string[] = [];
    const isSrNorm = norm === "scan_rate" || norm === "sqrt_scan_rate" || norm === "bv";
    selWithData.forEach(({ file, cycleN }) => {
      const n = `${getLabel(file.id, file.name)}_c${cycleN}`;
      headers.push(`Pot_${n}`, `Cur_${n}`);
      units.push("V", "mA");
      if (isSrNorm) {
        const normUnit = norm === "scan_rate" ? "mA·s/V" : norm === "sqrt_scan_rate" ? "mA·s½/V½" : `mA·s^${bExp}/V^${bExp}`;
        headers.push(`CurNorm_${n}`);
        units.push(normUnit);
      }
    });

    const maxLen = Math.max(0, ...selWithData.map(s => s.curve.vf.length));
    const rows: string[] = [];
    for (let r = 0; r < maxLen; r++) {
      const row = selWithData.flatMap(({ file, curve }) => {
        const srMvsCsv = parseScanRateMvs(file.metadata?.SCANRATE) ?? manualRates[file.id] ?? null;
        const srVsCsv  = srMvsCsv != null ? srMvsCsv / 1000 : 1.0;
        const divCsv   = norm === "area"           ? normVal
                       : norm === "mass"           ? normVal / 1000
                       : norm === "scan_rate"      ? srVsCsv
                       : norm === "sqrt_scan_rate" ? Math.sqrt(srVsCsv)
                       : norm === "bv"             ? Math.pow(srVsCsv, bExp)
                       : 1.0;
        const cols = [
          curve.vf[r] !== undefined ? (curve.vf[r] + vOffset).toFixed(6) : "",
          curve.im[r] !== undefined ? (curve.im[r] * 1000).toFixed(6) : "",
        ];
        if (isSrNorm) {
          cols.push(curve.im[r] !== undefined ? ((curve.im[r] / divCsv) * 1000).toFixed(6) : "");
        }
        return cols;
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

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex flex-col gap-0.5 px-3 py-1.5 bg-gray-100 border-b border-gray-300 text-xs text-gray-900 shrink-0">

        {/* Per-file rows */}
        {comparison.selections.map(sel => {
          const file = fileMap[sel.fileId];
          if (!file) return null;
          const maxCycles = file.curves?.length ?? 1;
          const cycleVal  = Math.min(Math.max(1, cycles[sel.fileId] ?? 1), maxCycles);
          const sr        = parseScanRateMvs(file.metadata?.SCANRATE);
          const isSrNormRow = norm === "scan_rate" || norm === "sqrt_scan_rate" || norm === "bv";
          const isVisible = visible[sel.fileId] !== false;
          return (
            <div key={sel.fileId} className="flex items-center gap-2 flex-wrap">
              <button onClick={() => toggleVisible(sel.fileId)}
                      className={`shrink-0 transition-colors cursor-pointer ${isVisible ? "text-forest-500 hover:text-forest-300" : "text-gray-400 hover:text-gray-600"}`}
                      title={isVisible ? "Hide trace" : "Show trace"}>
                {isVisible ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
              <span className={`text-[10px] rounded px-1.5 py-0.5 truncate max-w-[110px] transition-colors ${isVisible ? "bg-forest-800 text-forest-300" : "bg-gray-200 text-gray-400"}`}>
                {getLabel(file.id, file.name)}
              </span>
              {sr != null && (
                <span className="text-[9px] text-forest-400 shrink-0">{sr} mV/s</span>
              )}
              {isSrNormRow && sr == null && (
                <label className="flex items-center gap-1 text-[10px] text-gray-600">
                  ν
                  <input type="number" min={0.1} step={1} placeholder="mV/s"
                         value={manualRates[sel.fileId] ?? ""}
                         onChange={e => setManualRates(prev => ({ ...prev, [sel.fileId]: Number(e.target.value) }))}
                         className={`w-16 ${inputCls}`} />
                  <span className="text-gray-400">mV/s</span>
                </label>
              )}
              {maxCycles > 1 && (
                <label className="flex items-center gap-1 text-[10px] text-gray-600">
                  Cycle
                  <input
                    type="number" value={cycleVal} min={1} max={maxCycles}
                    onChange={e => setCycles(prev => ({
                      ...prev,
                      [sel.fileId]: Math.min(Math.max(1, Number(e.target.value)), maxCycles),
                    }))}
                    className={`w-10 ${inputCls}`}
                  />
                  <span className="text-gray-400">/ {maxCycles}</span>
                </label>
              )}
            </div>
          );
        })}

        {/* Shared controls */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 border-t border-gray-200">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-gray-500 shrink-0">Ref</span>
            <select value={refFrom} onChange={e => setRefFrom(e.target.value)} className={`${inputCls} text-[10px]`}>
              {ELECTRODE_OPTIONS.map(k => <option key={k}>{k}</option>)}
            </select>
            <span className="text-gray-400 shrink-0">→</span>
            <select value={refTo} onChange={e => setRefTo(e.target.value)} className={`${inputCls} text-[10px]`}>
              {ELECTRODE_OPTIONS.map(k => <option key={k}>{k}</option>)}
            </select>
            {(refFrom === "RHE" || refTo === "RHE") && (
              <label className="flex items-center gap-1">
                <span className="text-[10px] text-gray-500">pH</span>
                <input type="number" value={pH} min={0} max={14} step={0.5}
                       onChange={e => setPH(Number(e.target.value))}
                       className={`w-10 ${inputCls}`} />
              </label>
            )}
            {vOffset !== 0 && (
              <span className="text-[9px] text-gray-400 shrink-0">
                ({vOffset > 0 ? "+" : ""}{vOffset.toFixed(3)} V)
              </span>
            )}
          </div>
          <select value={norm} onChange={e => setNorm(e.target.value as "none"|"area"|"mass"|"scan_rate"|"sqrt_scan_rate"|"bv")} className={inputCls}>
            <option value="none">No normalisation</option>
            <option value="area">By area (cm²)</option>
            <option value="mass">By mass (mg)</option>
            <option value="scan_rate">Divide by ν</option>
            <option value="sqrt_scan_rate">Divide by √ν</option>
            <option value="bv">Divide by ν^b</option>
          </select>
          {(norm === "area" || norm === "mass") && (
            <input type="number" value={normVal} min={0.001} step={0.01}
                   onChange={e => setNormVal(Number(e.target.value))}
                   className={`w-16 ${inputCls}`} />
          )}
          {norm === "bv" && (
            <label className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500 shrink-0">b</span>
              <input type="number" value={bExp} min={0.1} max={1.5} step={0.05}
                     onChange={e => setBExp(Number(e.target.value))}
                     className={`w-14 ${inputCls}`} />
            </label>
          )}
          <div className="flex rounded overflow-hidden border border-gray-300 shrink-0">
            <button onClick={() => setDragmode('zoom')} title="Box zoom"
              className={`px-2 py-0.5 text-[10px] transition-colors ${dragmode === 'zoom' ? 'bg-forest-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}>
              Zoom
            </button>
            <button onClick={() => setDragmode('pan')} title="Drag to pan"
              className={`px-2 py-0.5 text-[10px] transition-colors ${dragmode === 'pan' ? 'bg-forest-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}>
              Pan
            </button>
          </div>

          <button onClick={() => setAxesOpen(o => !o)}
                  className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${axesOpen ? "bg-forest-50 border-forest-400 text-forest-700" : "border-gray-300 text-gray-500 hover:text-gray-700"}`}>
            Axes {axesOpen ? "▴" : "▾"}
          </button>
        </div>

        {/* Axes inputs */}
        {axesOpen && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 border-t border-gray-200">
            <span className="font-semibold text-gray-600">X</span>
            <AxisInput value={xMin} onChange={setXMin} placeholder="min" className={`w-16 ${inputCls}`} />
            <span className="text-gray-400">–</span>
            <AxisInput value={xMax} onChange={setXMax} placeholder="max" className={`w-16 ${inputCls}`} />
            <label className="flex items-center gap-1 cursor-pointer text-gray-600">
              <input type="checkbox" checked={xLog} onChange={e => setXLog(e.target.checked)} className="accent-forest-400" /> log
            </label>
            <span className="text-gray-300 px-1">│</span>
            <span className="font-semibold text-gray-600">Y</span>
            <AxisInput value={yMin} onChange={setYMin} placeholder="min" className={`w-16 ${inputCls}`} />
            <span className="text-gray-400">–</span>
            <AxisInput value={yMax} onChange={setYMax} placeholder="max" className={`w-16 ${inputCls}`} />
            <label className="flex items-center gap-1 cursor-pointer text-gray-600">
              <input type="checkbox" checked={yLog} onChange={e => setYLog(e.target.checked)} className="accent-forest-400" /> log
            </label>
            {(xMin || xMax || yMin || yMax) && (
              <button onClick={() => { setXMin(""); setXMax(""); setYMin(""); setYMax(""); }}
                      className="text-[10px] text-gray-400 hover:text-red-500 border border-gray-300 rounded px-1.5 py-0.5 transition-colors">
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
            <div className="w-full flex items-center gap-2 pt-1 border-t border-gray-100">
              <span className="text-[10px] font-semibold text-gray-500 shrink-0">X label</span>
              <input type="text" placeholder={xLabel} value={xTitleOverride} onChange={e => setXTitleOverride(e.target.value)}
                     className={`flex-1 min-w-0 ${inputCls} text-[10px]`} />
              <span className="text-[10px] font-semibold text-gray-500 shrink-0">Y label</span>
              <input type="text" placeholder={yLabel} value={yTitleOverride} onChange={e => setYTitleOverride(e.target.value)}
                     className={`flex-1 min-w-0 ${inputCls} text-[10px]`} />
            </div>
          </div>
        )}
      </div>

      {/* Plot */}
      <div ref={plotRef} className="relative flex-1 min-h-0">
        <div className="absolute inset-0">
          <Plot key={plotKey} data={styledData} layout={layout} onRelayout={onRelayout as never}
                config={{ responsive: true, displayModeBar: "hover", displaylogo: false, scrollZoom: true, edits: { legendPosition: true } }}
                style={{ width: "100%", height: "100%" }} useResizeHandler />
        </div>
      </div>
    </div>
  );
}
