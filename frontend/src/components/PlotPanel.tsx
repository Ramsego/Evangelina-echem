import React, { useState, useRef, useEffect, useMemo } from "react";
import Plot from "react-plotly.js";
import { GripHorizontal, X, Download, Palette, Maximize2, Minimize2, Minus, Plus, AlertTriangle, Table2 } from "lucide-react";
import { ParsedFile } from "../types";
import { useQuery } from "@tanstack/react-query";
import { fetchCycles, getExportCapabilities, exportData, exportSheets, ExportCapabilities, CycleSegment } from "../api/client";
import { useLocalStorage } from "../hooks/useLocalStorage";
import CVPanel from "./panels/CVPanel";
import EISPanel from "./panels/EISPanel";
import GCDPanel from "./panels/GCDPanel";
import FullscreenOverlay from "./FullscreenOverlay";
import { useExportContext, ExportFmt, CollectResult } from "../context/ExportContext";
import { useStyleContext, useStyle } from "../context/StyleContext";
import { applyStyleToData, applyStyleToLayout, resolveLegendFontSize } from "../utils/applyStyle";
import { useZoom } from "../hooks/useZoom";
import { computeExtents } from "../utils/plotUtils";
import { useZoomClamp } from "../hooks/useZoomClamp";
import { useFileLabels } from "../context/FileLabelContext";
import { buildZip, exportPlotImage, downloadCsv, downloadTxt, buildSummaryTxt, metaComments, metaLines, decimateRows, PanelSummary } from "../utils/exportUtils";
import { computeCE, computeSeesawEsr } from "../utils/ceUtils";
import { useContainerSize } from "../hooks/useContainerSize";
import Tooltip from "./Tooltip";

const ETYPE_LABEL: Record<string, string> = {
  CV:     "CV",
  LSV:    "LSV",
  EISPOT: "EIS",
  CHRONOP: "GCD",
  PWR800_CYCLICCHARGEDISCHARGE: "GCD",
  SEESAW: "GCD cycles",
};

const ETYPE_COLOR: Record<string, string> = {
  CV:      "bg-forest-700/50 text-forest-300",
  LSV:     "bg-forest-700/50 text-forest-300",
  EISPOT:  "bg-forest-600/40 text-forest-200",
  CHRONOP: "bg-forest-700/50 text-forest-300",
  PWR800_CYCLICCHARGEDISCHARGE: "bg-forest-700/50 text-forest-300",
  SEESAW:  "bg-amber-900/40 text-amber-300",
};

const ETYPE_BORDER: Record<string, string> = {
  CV:      "border-l-4 border-l-forest-400",
  LSV:     "border-l-4 border-l-forest-400",
  EISPOT:  "border-l-4 border-l-forest-300",
  CHRONOP: "border-l-4 border-l-forest-600",
  PWR800_CYCLICCHARGEDISCHARGE: "border-l-4 border-l-forest-600",
  SEESAW:  "border-l-4 border-l-amber-500",
};

interface Props {
  file: ParsedFile;
  onRemove: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  allFiles?: ParsedFile[];
  bgFileId?: string | null;
  capVLo?: string;
  capVHi?: string;
  capKey?: number;
  onFocus?: () => void;
  onAnalyse?: () => void;
}

interface PanelHeaderProps extends Props {
  onFullscreen: () => void;
  isFullscreen?: boolean;
}

function PanelHeader({ file, onRemove, isCollapsed, onToggleCollapse, onFullscreen, isFullscreen, onAnalyse }: PanelHeaderProps) {
  const { exportOne, collectOne, collectSheets } = useExportContext();
  const { selectedId, setSelected, panelStyles } = useStyleContext();
  const headerStyle = useStyle(file.id);
  const { getLabel, setLabel } = useFileLabels();
  const isSelected  = selectedId === file.id;
  const hasOverride = !!panelStyles[file.id];
  const [open,         setOpen]         = useState(false);
  const [fmts,         setFmts]         = useState<Set<ExportFmt>>(new Set());
  const [filename,     setFilename]     = useState(() => file.name.replace(/\.dta$/i, ''));
  const [exporting,    setExporting]    = useState(false);
  const [editing,      setEditing]      = useState(false);
  const [draft,        setDraft]        = useState("");
  const [caps,         setCaps]         = useState<ExportCapabilities | null>(null);
  const [originExporting, setOriginExporting] = useState(false);
  const [originError,  setOriginError]  = useState<string | null>(null);
  const [showHint, setShowHint] = useState(() => !localStorage.getItem("gamry-hints-seen"));

  useEffect(() => {
    if (!showHint) return;
    const t = setTimeout(() => { localStorage.setItem("gamry-hints-seen", "1"); setShowHint(false); }, 10000);
    return () => clearTimeout(t);
  }, [showHint]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const etypeLabel = file.etype ? (ETYPE_LABEL[file.etype] ?? file.etype) : "Unknown";
  const etypeColor = file.etype ? (ETYPE_COLOR[file.etype] ?? "bg-forest-700/50 text-forest-400") : "bg-forest-700/50 text-forest-400";
  const displayName = getLabel(file.id, file.name);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    getExportCapabilities().then(setCaps).catch(() => {});
  }, []);

  function toggleFmt(f: ExportFmt) {
    setFmts(prev => { const next = new Set(prev); next.has(f) ? next.delete(f) : next.add(f); return next; });
  }

  async function handleOriginExport(fmt: "xlsx" | "csv" | "opju") {
    setOriginError(null);
    setOriginExporting(true);
    try {
      const stem  = filename || file.name.replace(/\.dta$/i, "");
      const etype = (file.etype === "CHRONOP" || file.etype === "PWR800_CYCLICCHARGEDISCHARGE")
        ? "GCD"
        : (file.etype as "CV" | "LSV" | "EISPOT" | "GCD");

      // CV/LSV: export exactly the plotted columns the panel built (selected
      // cycles, offset, normalisation, background) — never the full file.
      if (etype === "CV" || etype === "LSV") {
        const sheets = collectSheets(file.id);
        if (!sheets) throw new Error("Plot data not ready — open the panel and try again");
        await exportSheets(sheets, stem, fmt);
      } else {
        // EIS/GCD single-file panels plot the whole spectrum / cycle set, so the
        // typed payload is already what's on screen.
        const payload: Record<string, unknown> = { etype, filename: file.name };
        if (etype === "EISPOT") payload.eis = file.eis;
        else                    payload.gcd = file.gcd;
        await exportData(payload, stem, fmt);
      }
      setOpen(false);
    } catch (err) {
      setOriginError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setOriginExporting(false);
    }
  }

  async function handleDownload() {
    const fmtList = [...fmts];
    if (fmtList.length === 0) return;
    setExporting(true);
    try {
      if (fmtList.length === 1) {
        exportOne(file.id, fmtList[0], filename || undefined);
      } else {
        const entry = collectOne(file.id);
        if (entry) await buildZip([entry], fmtList, filename || file.name.replace(/\.dta$/i, ''), headerStyle.exportShape);
      }
    } finally {
      setExporting(false);
      setOpen(false);
    }
  }

  function handleLlmDownload() {
    const summary = collectOne(file.id)?.summary;
    if (!summary) return;
    const text = buildSummaryTxt(file.name, summary.etypeLabel, summary.sections, summary.llmInstructions);
    downloadTxt(text, filename || file.name.replace(/\.dta$/i, ""));
    setOpen(false);
  }

  return (
    <div className="drag-handle flex items-center gap-2 px-3 py-2 bg-forest-850 border-b border-forest-700 cursor-grab active:cursor-grabbing select-none">
      <GripHorizontal size={13} className="text-forest-600 shrink-0" />

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { setLabel(file.id, draft); setEditing(false); }}
          onKeyDown={e => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="flex-1 text-xs bg-transparent text-forest-200 outline-none border-b border-forest-400"
          onMouseDown={e => e.stopPropagation()}
        />
      ) : (
        <span
          className="text-xs text-forest-200 truncate flex-1 font-medium cursor-text"
          onDoubleClick={() => { setDraft(displayName); setEditing(true); }}
          onMouseDown={e => e.stopPropagation()}
          title="Double-click to rename"
        >
          {displayName}
        </span>
      )}

      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${etypeColor}`}>
        {etypeLabel}
      </span>

      {onAnalyse && (
        <Tooltip content="Open analysis table">
          <button
            onClick={onAnalyse}
            onMouseDown={e => e.stopPropagation()}
            className="shrink-0 text-forest-600 hover:text-forest-300 transition-colors cursor-pointer"
          >
            <Table2 size={13} />
          </button>
        </Tooltip>
      )}

      <Tooltip content="Customise plot style">
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => setSelected(isSelected ? null : file.id)}
          className={`relative shrink-0 transition-colors cursor-pointer ${isSelected ? "text-forest-300" : "text-forest-600 hover:text-forest-400"}`}
        >
          <Palette size={13} />
          {hasOverride && !isSelected && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
          )}
        </button>
      </Tooltip>

      <div ref={wrapperRef} className="relative shrink-0" onMouseDown={e => e.stopPropagation()}>
        <Tooltip content="Export / download">
          <button
            onClick={() => { setOpen(o => !o); if (showHint) { localStorage.setItem("gamry-hints-seen", "1"); setShowHint(false); } }}
            className="relative flex items-center gap-1 text-forest-600 hover:text-forest-300 transition-colors cursor-pointer"
          >
            {showHint && <span className="absolute inset-0 rounded border border-forest-400 animate-ping pointer-events-none opacity-75" />}
            <Download size={13} />
            <span className="text-[10px] text-forest-500 leading-none">Export</span>
          </button>
        </Tooltip>
        {open && (
          <div className="absolute right-0 top-full mt-1 z-20 bg-forest-900 border border-forest-700 rounded shadow-lg p-2.5 min-w-[190px]">
            <div className="flex gap-3 mb-2">
              {(["png", "svg", "csv"] as ExportFmt[]).map(f => (
                <label key={f} className="flex items-center gap-1 cursor-pointer text-[11px] text-forest-300 select-none">
                  <input type="checkbox" checked={fmts.has(f)} onChange={() => toggleFmt(f)} className="accent-forest-400" />
                  {f.toUpperCase()}
                </label>
              ))}
            </div>
            <input
              type="text"
              value={filename}
              onChange={e => setFilename(e.target.value)}
              className="w-full text-[10px] bg-forest-800 border border-forest-600 rounded px-1.5 py-0.5 text-forest-200 mb-2 outline-none focus:border-forest-400"
            />
            <button
              onClick={handleDownload}
              disabled={fmts.size === 0 || exporting}
              className="w-full text-[10px] bg-forest-700 hover:bg-forest-600 text-forest-100 rounded px-2 py-1 disabled:opacity-40 transition-colors cursor-pointer"
            >
              {exporting ? "Exporting…" : fmts.size >= 2 ? "Download ZIP" : "Download"}
            </button>

            <div className="border-t border-forest-700 my-2" />
            <div className="text-[10px] text-forest-500 mb-1.5">For LLM analysis</div>
            <button
              onClick={handleLlmDownload}
              className="w-full text-[10px] bg-forest-800 hover:bg-forest-700 text-forest-300 border border-forest-700 rounded px-1.5 py-0.5 transition-colors cursor-pointer"
            >
              Download .txt (values, formulas, data)
            </button>

            {/* Origin-compatible export */}
            {file.etype && file.etype !== "SEESAW" && (
              <>
                <div className="border-t border-forest-700 my-2" />
                <div className="text-[10px] text-forest-500 mb-1.5">Origin-compatible</div>
                <div className="flex gap-1.5">
                  {(["xlsx", "csv"] as const).map(fmt => (
                    <button
                      key={fmt}
                      onClick={() => handleOriginExport(fmt)}
                      disabled={originExporting}
                      className="flex-1 text-[10px] bg-forest-800 hover:bg-forest-700 text-forest-300 border border-forest-700 rounded px-1.5 py-0.5 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                  {caps?.opju && (
                    <button
                      onClick={() => handleOriginExport("opju")}
                      disabled={originExporting}
                      className="flex-1 text-[10px] bg-forest-800 hover:bg-forest-700 text-forest-300 border border-forest-700 rounded px-1.5 py-0.5 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      .opju
                    </button>
                  )}
                </div>
                {originError && (
                  <p className="text-[10px] text-red-400 mt-1.5 leading-tight">{originError}</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {!isFullscreen && (
        <Tooltip content={isCollapsed ? "Expand panel" : "Collapse to tab"}>
          <button
            onClick={onToggleCollapse}
            onMouseDown={e => e.stopPropagation()}
            className="shrink-0 text-forest-600 hover:text-forest-300 transition-colors cursor-pointer"
          >
            {isCollapsed ? <Plus size={13} /> : <Minus size={13} />}
          </button>
        </Tooltip>
      )}

      <Tooltip content={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
        <button
          onClick={onFullscreen}
          onMouseDown={e => e.stopPropagation()}
          className="shrink-0 text-forest-600 hover:text-forest-300 transition-colors cursor-pointer"
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </Tooltip>

      <Tooltip content="Remove file — also removes it from any comparisons and analyses">
        <button
          onClick={onRemove}
          onMouseDown={e => e.stopPropagation()}
          className="shrink-0 text-forest-600 hover:text-red-400 transition-colors cursor-pointer"
        >
          <X size={13} />
        </button>
      </Tooltip>
    </div>
  );
}

function computeDQDV(
  times: number[],
  voltages: number[],
  currentMA: number,
  smoothWindow: number,
): { v: number[]; dqdv: number[] } {
  const rawV: number[] = [];
  const rawDQDV: number[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    const dt = times[i + 1] - times[i];
    const dv = voltages[i + 1] - voltages[i];
    if (Math.abs(dt) < 0.001 || Math.abs(dv) < 0.0005) continue;
    const dq = currentMA * dt / 3600; // mAh
    rawV.push((voltages[i] + voltages[i + 1]) / 2);
    rawDQDV.push(dq / dv);
  }
  if (smoothWindow <= 1 || rawDQDV.length === 0) return { v: rawV, dqdv: rawDQDV };
  const half = Math.floor(smoothWindow / 2);
  const smoothed = rawDQDV.map((_, idx) => {
    const lo = Math.max(0, idx - half);
    const hi = Math.min(rawDQDV.length - 1, idx + half);
    let sum = 0, count = 0;
    for (let j = lo; j <= hi; j++) { sum += rawDQDV[j]; count++; }
    return sum / count;
  });
  return { v: rawV, dqdv: smoothed };
}

function buildVQSegment(
  times: number[], voltages: number[], currentMA: number
): { q: number[]; v: number[] } {
  let cumQ = 0;
  const q = times.map((t, i) => {
    if (i > 0) cumQ += Math.abs(currentMA) * (t - times[i - 1]) / 3600; // mAh
    return cumQ;
  });
  return { q, v: voltages };
}

// The /cycles endpoint returns charge and discharge concatenated into flat
// arrays plus the index ranges of each half-cycle. Slice at those ranges and
// take the label as ground truth (the instrument pre-split the files) rather
// than inferring it from voltage direction.
function segmentsFromServer(
  data: { times: number[]; voltages: number[]; segments?: CycleSegment[] },
  currentMA: number,
): Array<{ q: number[]; v: number[]; label: string }> {
  if (!data.segments) return [];
  return data.segments.map(s => {
    const t = data.times.slice(s.start, s.end + 1);
    const v = data.voltages.slice(s.start, s.end + 1);
    const seg = buildVQSegment(t, v, currentMA);
    return { ...seg, label: s.label };
  });
}

function SeesawPanel({ file, onRemove, isCollapsed, onToggleCollapse }: Props) {
  const allCycles = file.all_cycles ?? [];
  const min = allCycles[0] ?? 1;
  const max = allCycles[allCycles.length - 1] ?? 1;
  const [start,        setStart]        = useState(min);
  const [end,          setEnd]          = useState(Math.min(min + 9, max));
  const [fullscreen,   setFullscreen]   = useState(false);
  const [view,         setView]         = useLocalStorage<"voltage"|"vq"|"dqdv">(`${file.id}.ssView`, "voltage");
  const [currentMA,    setCurrentMA]    = useLocalStorage(`${file.id}.ssCurrent`, 1.0);
  const [smoothWindow, setSmoothWindow] = useState(5);
  const [vqCycle,      setVqCycle]      = useState(min);
  const style = useStyle(file.id);
  const { setLegendAutoSize } = useStyleContext();
  const uiRevKey = `${file.id}-${view}`;
  const { onRelayout: zoomOnRelayout, legendState } = useZoom(uiRevKey);
  const [plotRef, plotSize] = useContainerSize();

  const qStart = view === "vq" ? vqCycle : start;
  const qEnd   = view === "vq" ? vqCycle : end;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["cycles", file.id, qStart, qEnd],
    queryFn:  () => fetchCycles(file.id, qStart, qEnd),
  });

  const dqdvResult = useMemo(() => {
    if (!data || view !== "dqdv") return null;
    return computeDQDV(data.times, data.voltages, currentMA, smoothWindow);
  }, [data, view, currentMA, smoothWindow]);

  const vqResult = useMemo(() => {
    if (!data || view !== "vq") return null;
    return segmentsFromServer(data, currentMA);
  }, [data, view, currentMA]);

  // CE for the selected cycle — requires exactly one charge and one discharge segment
  const ceResult = useMemo(() => {
    if (view !== "vq" || !vqResult || vqResult.length === 0) return null;
    return computeCE(vqResult);
  }, [view, vqResult]);

  // ESR from the V–Q charge→discharge boundary (frontend-only; current is user-entered)
  const esrResult = useMemo(() => {
    if (view !== "vq" || !vqResult || vqResult.length === 0) return null;
    return computeSeesawEsr(vqResult, currentMA);
  }, [view, vqResult, currentMA]);

  const plotData: Plotly.Data[] = useMemo(() => {
    if (!data) return [];
    if (view === "dqdv" && dqdvResult) {
      return [{ x: dqdvResult.v, y: dqdvResult.dqdv, type: "scatter", mode: "lines",
                name: `dQ/dV (cycles ${start}–${end})`,
                line: { color: "#D4A057", width: 1.5 } }];
    }
    if (view === "vq" && vqResult) {
      const palette = ["#74C69D", "#52B788"];
      return vqResult.map((seg, i) => ({
        x: seg.q, y: seg.v, type: "scatter" as const, mode: "lines" as const,
        name: seg.label, line: { color: palette[i % palette.length], width: 1.5 },
      }));
    }
    return [{ x: data.times, y: data.voltages, type: "scatter", mode: "lines",
              name: `Cycles ${start}–${end}`,
              line: { color: "#74C69D", width: 1.5 } }];
  }, [data, view, dqdvResult, vqResult, start, end]);

  const styledData   = useMemo(() => applyStyleToData(plotData, style),  [plotData, style]);
  const extents      = useMemo(() => { const e = computeExtents(styledData); return e ? { ...e } : null; }, [styledData]);
  const { onRelayout, clamp, uirevision, plotKey } = useZoomClamp(extents, zoomOnRelayout, uiRevKey);

  const rawLayout    = useMemo((): Partial<Plotly.Layout> => ({
    margin: { l: 56, r: 16, t: 10, b: 48 },
    xaxis:  { title: { text: view === "dqdv" ? "Potential (V)" : view === "vq" ? "Capacity (mAh)" : "Time (s)" } },
    yaxis:  { title: { text: view === "dqdv" ? "dQ/dV (mAh/V)" : "Potential (V)" } },
  }), [view]);
  const styledLayout = useMemo(() => applyStyleToLayout(rawLayout, style), [rawLayout, style]);
  const legendFontSize = resolveLegendFontSize(style, plotSize);
  useEffect(() => { setLegendAutoSize(file.id, legendFontSize); }, [file.id, legendFontSize, setLegendAutoSize]);
  const finalLayout  = useMemo((): Partial<Plotly.Layout> => ({
    ...styledLayout,
    uirevision,
    legend: {
      ...(styledLayout.legend as object ?? {}),
      font: { ...(((styledLayout.legend as { font?: object } | undefined)?.font) ?? {}), size: legendFontSize },
      ...(legendState.x != null ? { x: legendState.x, y: legendState.y } : {}),
    },
    ...(clamp.x && { xaxis: { ...(styledLayout.xaxis ?? {}), autorange: false as const, range: clamp.x } }),
    ...(clamp.y && { yaxis: { ...(styledLayout.yaxis ?? {}), autorange: false as const, range: clamp.y } }),
  }), [styledLayout, uirevision, legendFontSize, legendState, clamp]);

  // ── Export ───────────────────────────────────────────────────────────────
  const { register, unregister } = useExportContext();
  const handleExportRef = useRef<(fmt: ExportFmt, name?: string) => void>(() => {});
  const collectRef      = useRef<() => CollectResult>(() => ({ filename: '', csv: '', plotData: [], layout: {} }));
  useEffect(() => {
    register(file.id, (fmt, name) => handleExportRef.current(fmt, name), () => collectRef.current());
    return () => unregister(file.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only registration, register/unregister are stable

  const plottedRows = (): { headers: string[]; units: string[]; rows: string[] } => {
    if (!data) return { headers: ["Time", "Voltage"], units: ["s", "V"], rows: [] };
    return {
      headers: ["Time", "Voltage"],
      units:   ["s", "V"],
      rows:    data.times.map((t, i) => `${t.toFixed(4)},${data.voltages[i].toFixed(6)}`),
    };
  };

  const buildCsv = (): string => {
    if (!data) return "";
    const meta = [...metaComments(file.metadata), `# Cycles ${qStart}-${qEnd}`];
    const { headers, units, rows } = plottedRows();
    return [...meta, headers.join(","), units.join(","), ...rows].join("\n");
  };

  const buildSummary = (): PanelSummary => {
    const values: string[] = [`Applied current: ${currentMA} mA (user-entered)`];
    const warnings: string[] = [];
    if (view === "vq" && ceResult) {
      if (ceResult.ce != null) {
        values.push(
          `Cycle ${vqCycle}:`,
          `  Q_charge: ${ceResult.qCh!.toFixed(4)} mAh  [Q = I × Δt over the charge half-cycle]`,
          `  Q_discharge: ${ceResult.qDis!.toFixed(4)} mAh`,
          `  CE: ${ceResult.ce.toFixed(2)}%  [CE = Q_dis / Q_ch × 100]`,
        );
      }
      warnings.push(...ceResult.warnings);
      if (esrResult && esrResult.esr != null) {
        values.push(
          `  ESR: ${esrResult.esr.toFixed(4)} Ω  [ESR = ΔV / (2·I), I is user-entered]`,
          `  ΔV (reversal): ${((esrResult.dV ?? 0) * 1000).toFixed(2)} mV`,
        );
        warnings.push(...esrResult.warnings);
      }
    } else {
      values.push(`View: ${view === "dqdv" ? `dQ/dV, cycles ${start}–${end}, smoothing window ${smoothWindow}` : `V–t, cycles ${start}–${end}`}`);
    }
    const definitions = [
      "Q (half-cycle capacity): Applied current × duration of the half-cycle, in mAh.",
      "  Half-cycles are segmented at voltage direction reversals.",
      "CE (coulombic efficiency): Q_discharge / Q_charge × 100 for the selected cycle.",
      "ESR (SEESAW): ΔV at the charge→discharge voltage reversal divided by 2·I.",
      "  ΔV is measured 2 points either side of the transition to skip transients.",
      "  I is the user-entered current (mA); note this assumes a symmetric ±I step.",
    ];
    const { headers, units, rows } = plottedRows();
    const { rows: dataSample, note: dataNote } = decimateRows(rows);

    return {
      etypeLabel: "GCD cycles (SEESAW)",
      sections: [
        { title: "Instrument metadata", lines: metaLines(file.metadata) },
        { title: "Computed values", lines: values },
        { title: "Warnings", lines: warnings.length ? warnings : ["(none)"] },
        { title: "Definitions", lines: definitions },
        { title: `Data table (${dataNote})`, lines: [headers.join(","), units.join(","), ...dataSample] },
      ],
      llmInstructions: `Do not make assumptions about the experimental setup. First ask the user for any missing\ninformation that could materially affect interpretation of this galvanostatic cycling data\n(chemistry, electrode, current/C-rate, voltage window, temperature, experimental\nobjective). Once sufficient context has been provided, interpret the values\nquantitatively, explain any uncertainty, list possible explanations for anomalies, and\nsuggest follow-up experiments to distinguish between them.`,
    };
  };

  handleExportRef.current = (fmt: ExportFmt, name?: string) => {
    const stem = name ?? file.name.replace(/\.dta$/i, "");
    if (fmt === "csv") { downloadCsv(buildCsv(), stem); return; }
    exportPlotImage(styledData, finalLayout, stem, fmt as "png" | "svg");
  };
  collectRef.current = () => ({
    filename: file.name.replace(/\.dta$/i, ''),
    csv: buildCsv(),
    summary: buildSummary(),
    plotData: styledData,
    layout: finalLayout,
  });

  const controls = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 bg-panel-header border-b border-panel-border text-xs text-panel-text shrink-0">
      <div className="flex rounded overflow-hidden border border-panel-border">
        <button onClick={() => setView("voltage")}
          className={`px-2 py-0.5 text-[10px] transition-colors ${view === "voltage" ? "bg-forest-600 text-white" : "text-panel-muted hover:bg-panel-bg"}`}>
          V–t
        </button>
        <button onClick={() => setView("vq")}
          className={`px-2 py-0.5 text-[10px] transition-colors ${view === "vq" ? "bg-forest-600 text-white" : "text-panel-muted hover:bg-panel-bg"}`}>
          V–Q
        </button>
        <button onClick={() => setView("dqdv")}
          className={`px-2 py-0.5 text-[10px] transition-colors ${view === "dqdv" ? "bg-forest-600 text-white" : "text-panel-muted hover:bg-panel-bg"}`}>
          dQ/dV
        </button>
      </div>
      {view === "vq" ? (
        <>
          <span className="text-panel-muted">Cycle</span>
          <input type="number" value={vqCycle} min={min} max={max}
                 onChange={e => setVqCycle(Number(e.target.value))}
                 className="w-14 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400" />
          <span className="text-panel-muted">of {max}</span>
        </>
      ) : (
        <>
          <span className="text-panel-muted">Cycles</span>
          <input type="number" value={start} min={min} max={end - 1}
                 onChange={e => setStart(Number(e.target.value))}
                 className="w-14 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400" />
          <span className="text-panel-muted">–</span>
          <input type="number" value={end} min={start + 1} max={max}
                 onChange={e => setEnd(Number(e.target.value))}
                 className="w-14 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400" />
          <span className="text-panel-muted">of {max}</span>
        </>
      )}
      {isLoading && <span className="text-[10px] text-panel-muted animate-pulse">loading…</span>}
      {view === "vq" && ceResult && (
        <>
          {ceResult.ce != null && (
            <>
              <span className="text-[10px] bg-panel-bg text-panel-text rounded px-2 py-0.5" title="Q = I × Δt per half-cycle">
                Q_ch = {ceResult.qCh!.toFixed(3)} mAh · Q_dis = {ceResult.qDis!.toFixed(3)} mAh
              </span>
              <span className="text-[10px] bg-panel-bg text-panel-text rounded px-2 py-0.5" title="CE = Q_dis / Q_ch × 100">
                CE = {ceResult.ce.toFixed(1)}%
              </span>
            </>
          )}
          {ceResult.warnings.map((w, i) => (
            <span key={i} className="text-[10px] text-amber-600 bg-amber-400/20 border border-amber-400/50 rounded px-2 py-0.5">{w}</span>
          ))}
        </>
      )}
      {view === "vq" && esrResult && esrResult.esr != null && (
        <>
          <span className="text-[10px] bg-panel-bg text-panel-text rounded px-2 py-0.5" title="ESR = ΔV / (2·I), ΔV at current reversal">
            ESR = {esrResult.esr.toFixed(3)} Ω
          </span>
          <span className="text-[10px] bg-panel-bg text-panel-text rounded px-2 py-0.5" title="ΔV at current reversal">
            ΔV = {((esrResult.dV ?? 0) * 1000).toFixed(1)} mV
          </span>
        </>
      )}
      {view === "vq" && esrResult?.warnings.map((w, i) => (
        <span key={i} className="text-[10px] text-amber-600 bg-amber-400/20 border border-amber-400/50 rounded px-2 py-0.5">{w}</span>
      ))}
      {(view === "dqdv" || view === "vq") && (
        <>
          <span className="text-panel-muted pl-2 border-l border-panel-border">I (mA)</span>
          <input type="number" value={currentMA} min={0.001} step={0.1}
                 onChange={e => setCurrentMA(Number(e.target.value))}
                 className="w-16 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400" />
          {view === "dqdv" && (
            <>
              <span className="text-panel-muted">Smooth</span>
              <input type="range" min={1} max={50} value={smoothWindow}
                     onChange={e => setSmoothWindow(Number(e.target.value))}
                     className="w-20 accent-forest-400" />
              <span className="text-panel-muted w-6">{smoothWindow}</span>
            </>
          )}
        </>
      )}
    </div>
  );

  const plot = isError ? (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertTriangle size={24} className="text-amber-400 shrink-0" />
      <p className="text-xs text-forest-400 max-w-xs leading-relaxed">
        Cycle data is no longer available — the server may have restarted.
        Re-upload your <span className="text-forest-300 font-mono">.dta</span> file to restore this panel.
      </p>
    </div>
  ) : data && data.times.length === 0 ? (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-xs text-panel-muted">No data for selected cycle range</p>
    </div>
  ) : (
    <div ref={plotRef} className="relative flex-1 min-h-0">
      <div className="absolute inset-0">
        <Plot key={plotKey} data={styledData} layout={finalLayout} onRelayout={onRelayout as never}
              config={{ responsive: true, displayModeBar: "hover", displaylogo: false, scrollZoom: true, edits: { legendPosition: true } }}
              style={{ width: "100%", height: "100%" }} useResizeHandler />
      </div>
    </div>
  );

  return (
    <>
      <div className="h-full flex flex-col bg-forest-800 rounded-xl border border-forest-700 overflow-hidden border-l-4 border-l-amber-500">
        <PanelHeader file={file} onRemove={onRemove}
                     isCollapsed={isCollapsed} onToggleCollapse={onToggleCollapse}
                     onFullscreen={() => setFullscreen(true)} />
        {!isCollapsed && !fullscreen && <>{controls}{plot}</>}
      </div>
      {fullscreen && (
        <FullscreenOverlay onClose={() => setFullscreen(false)}>
          <div className="flex flex-col h-full bg-forest-800">
            <PanelHeader file={file} onRemove={onRemove}
                         isCollapsed={false} onToggleCollapse={() => {}}
                         onFullscreen={() => setFullscreen(false)} isFullscreen />
            {controls}{plot}
          </div>
        </FullscreenOverlay>
      )}
    </>
  );
}

function PlotPanel({ file, onRemove, isCollapsed, onToggleCollapse, allFiles, bgFileId, capVLo, capVHi, capKey, onFocus, onAnalyse }: Props) {
  const { selectedId } = useStyleContext();
  const isSelected = selectedId === file.id;
  const [fullscreen, setFullscreen] = useState(false);

  if (file.etype === "SEESAW") {
    return <SeesawPanel file={file} onRemove={onRemove} isCollapsed={isCollapsed} onToggleCollapse={onToggleCollapse} />;
  }

  const isCV  = file.etype === "CV" || file.etype === "LSV";
  const isEIS = file.etype === "EISPOT";
  const isGCD = file.etype === "CHRONOP" || file.etype === "PWR800_CYCLICCHARGEDISCHARGE";

  const inner = file.error ? (
    <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3 text-center">
      <AlertTriangle size={28} className="text-amber-400 shrink-0" />
      <p className="text-xs text-red-400 max-w-xs leading-relaxed">{file.error}</p>
    </div>
  ) : (
    <>
      {isCV  && <CVPanel  file={file} allFiles={allFiles} bgFileId={bgFileId} capVLo={capVLo} capVHi={capVHi} capKey={capKey} onFocus={onFocus} />}
      {isEIS && <EISPanel file={file} />}
      {isGCD && <GCDPanel file={file} />}
    </>
  );

  return (
    <>
      <div className={`h-full flex flex-col bg-forest-800 rounded-xl overflow-hidden transition-all ${isSelected ? "border-2 border-forest-400" : "border border-forest-700"} ${(file.etype ? ETYPE_BORDER[file.etype] : undefined) ?? "border-l-4 border-l-forest-600"}`}>
        <PanelHeader file={file} onRemove={onRemove} onAnalyse={onAnalyse}
                     isCollapsed={isCollapsed} onToggleCollapse={onToggleCollapse}
                     onFullscreen={() => setFullscreen(true)} />
        {!isCollapsed && !fullscreen && inner}
      </div>
      {fullscreen && (
        <FullscreenOverlay onClose={() => setFullscreen(false)}>
          <div className={`flex flex-col h-full bg-forest-800 ${isSelected ? "border-2 border-forest-400" : ""}`}>
            <PanelHeader file={file} onRemove={onRemove} onAnalyse={onAnalyse}
                         isCollapsed={false} onToggleCollapse={() => {}}
                         onFullscreen={() => setFullscreen(false)} isFullscreen />
            {inner}
          </div>
        </FullscreenOverlay>
      )}
    </>
  );
}

export default React.memo(PlotPanel, (prev, next) =>
  prev.file === next.file && prev.isCollapsed === next.isCollapsed
);
