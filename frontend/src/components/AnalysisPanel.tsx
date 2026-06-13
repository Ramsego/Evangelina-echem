import React, { useState, useRef, useEffect } from "react";
import { GripHorizontal, X, Download, Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import { ParsedFile, AnalysisSession } from "../types";
import { useExportContext } from "../context/ExportContext";
import { exportSheets } from "../api/client";
import { downloadCsv, exportPlotImage } from "../utils/exportUtils";
import CVAnalysisPanel, { CVAnalysisPlots, MetricRow } from "./panels/CVAnalysisPanel";
import EISAnalysisPanel from "./panels/EISAnalysisPanel";
import GCDAnalysisPanel from "./panels/GCDAnalysisPanel";
import FullscreenOverlay from "./FullscreenOverlay";

const TYPE_LABEL: Record<string, string> = {
  CV: "CV Analysis",    LSV: "CV Analysis",
  EISPOT: "EIS Analysis",
  CHRONOP: "GCD Analysis", PWR800_CYCLICCHARGEDISCHARGE: "GCD Analysis",
};
const TYPE_COLOR: Record<string, string> = {
  CV: "bg-forest-700/50 text-forest-300",    LSV: "bg-forest-700/50 text-forest-300",
  EISPOT: "bg-forest-600/40 text-forest-200",
  CHRONOP: "bg-forest-700/50 text-forest-300", PWR800_CYCLICCHARGEDISCHARGE: "bg-forest-700/50 text-forest-300",
};
const TYPE_BORDER: Record<string, string> = {
  CV:      "border-l-4 border-l-forest-400",
  LSV:     "border-l-4 border-l-forest-400",
  EISPOT:  "border-l-4 border-l-forest-300",
  CHRONOP: "border-l-4 border-l-forest-600",
  PWR800_CYCLICCHARGEDISCHARGE: "border-l-4 border-l-forest-600",
};

interface Props {
  session:         AnalysisSession;
  files:           ParsedFile[];
  onRemove:        () => void;
  isCollapsed:     boolean;
  onToggleCollapse: () => void;
  onRename:        (patch: Partial<AnalysisSession>) => void;
}

function AnalysisPanel({ session, files, onRemove, isCollapsed, onToggleCollapse, onRename }: Props) {
  const file  = files.find(f => f.id === session.fileId);
  const etype = file?.etype;
  const [fullscreen, setFullscreen] = useState(false);
  const [editing,    setEditing]    = useState(false);
  const [draft,      setDraft]      = useState("");

  const getCsvRef        = useRef<() => string>(() => "");
  const getPlotRef       = useRef<() => CVAnalysisPlots>(() => ({ dunn: null, sr: [] }));
  const getMetricRowsRef = useRef<() => MetricRow[]>(() => []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy,     setBusy]     = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { register, unregister } = useExportContext();

  const handleExportRef = useRef<(fmt: string) => void>(() => {});
  const collectRef      = useRef<() => import("../context/ExportContext").CollectResult>(
    () => ({ filename: session.name, csv: "", plotData: [], layout: {} }),
  );

  handleExportRef.current = (fmt: string) => {
    if (fmt === "csv") { downloadCsv(getCsvRef.current(), session.name); return; }
    if (fmt === "png" || fmt === "svg") {
      const plots = getPlotRef.current();
      const f = fmt as "png" | "svg";
      const base = session.name.replace(/\.dta$/i, "");
      if (plots.dunn) exportPlotImage(plots.dunn.data, plots.dunn.layout, `${base}_dunn`, f);
      plots.sr.forEach(p => exportPlotImage(p.data, p.layout, `${base}_${p.name}`, f));
    }
  };

  collectRef.current = () => {
    const plots = getPlotRef.current();
    const firstPlot = plots.dunn ?? plots.sr[0] ?? null;
    return {
      filename: session.name.replace(/\.dta$/i, ""),
      csv:      getCsvRef.current(),
      plotData: firstPlot?.data ?? [],
      layout:   firstPlot?.layout ?? {},
    };
  };

  useEffect(() => {
    register(session.id, fmt => handleExportRef.current(fmt), () => collectRef.current());
    return () => unregister(session.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- register/unregister are stable; mount-only registration is intentional

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const base = session.name.replace(/\.dta$/i, "");

  // The capacitance/peak table rendered as a Plotly table figure, so it exports
  // as an image even when the SR/Dunn accordions are closed. (Hex colours are
  // intentional for Plotly figures, per CLAUDE.md.)
  function exportTablePng() {
    const rows = getMetricRowsRef.current();
    if (!rows.length) return;
    const cols = ["Section", "Metric", "Cycle", "Value", "Unit"] as const;
    const cells = cols.map(c => rows.map(r => r[c.toLowerCase() as keyof MetricRow]));
    const trace = {
      type: "table" as const,
      header: {
        values: cols.map(c => `<b>${c}</b>`),
        fill: { color: "#1B4332" },
        font: { color: "#FFFFFF", size: 13 },
        align: "left" as const,
        height: 28,
      },
      cells: {
        values: cells,
        fill: { color: "#F4FBF7" },
        font: { color: "#0B1610", size: 12 },
        align: "left" as const,
        height: 24,
      },
    };
    exportPlotImage([trace] as never, { margin: { l: 8, r: 8, t: 8, b: 8 } }, `${base}_metrics`, "png");
  }

  async function exportTableXlsx() {
    const rows = getMetricRowsRef.current();
    if (!rows.length) return;
    setBusy(true);
    try {
      const sheet = {
        name: "Metrics",
        headers: ["Section", "Metric", "Cycle", "Value", "Unit", "Explanation"],
        rows: rows.map(r => [r.section, r.metric, r.cycle, r.value, r.unit, r.explanation]),
      };
      await exportSheets([sheet], base, "xlsx");
    } finally {
      setBusy(false);
    }
  }

  function exportSubPlots() {
    const plots = getPlotRef.current();
    if (plots.dunn) exportPlotImage(plots.dunn.data, plots.dunn.layout, `${base}_dunn`, "png");
    plots.sr.forEach(p => exportPlotImage(p.data, p.layout, `${base}_${p.name}`, "png"));
  }
  const hasSubPlots = () => { const p = getPlotRef.current(); return !!p.dunn || p.sr.length > 0; };

  const label = etype ? (TYPE_LABEL[etype] ?? "Analysis") : "Analysis";
  const color = etype ? (TYPE_COLOR[etype] ?? "bg-forest-700/50 text-forest-400") : "bg-forest-700/50 text-forest-400";

  const isCV  = etype === "CV" || etype === "LSV";
  const isEIS = etype === "EISPOT";
  const isGCD = etype === "CHRONOP" || etype === "PWR800_CYCLICCHARGEDISCHARGE";

  function renderHeader(fsMode: boolean) {
    return (
      <div className="drag-handle flex items-center gap-2 px-3 py-2 bg-forest-850 border-b border-forest-700 cursor-grab active:cursor-grabbing select-none">
        <GripHorizontal size={13} className="text-forest-600 shrink-0" />

        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { onRename({ name: draft.trim() || session.name }); setEditing(false); }}
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
            onDoubleClick={() => { setDraft(session.name); setEditing(true); }}
            onMouseDown={e => e.stopPropagation()}
            title="Double-click to rename"
          >
            {session.name}
          </span>
        )}

        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${color}`}>{label}</span>

        {isCV ? (
          <div ref={menuRef} className="relative shrink-0" onMouseDown={e => e.stopPropagation()}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              title="Export / download"
              className="text-forest-600 hover:text-forest-300 transition-colors cursor-pointer"
            >
              <Download size={13} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-5 z-20 flex flex-col w-40 rounded-md border border-forest-700 bg-forest-900 shadow-lg shadow-forest-950/40 py-1 text-[11px] text-forest-200">
                <button className="px-3 py-1.5 text-left hover:bg-forest-800 transition-colors" onClick={() => { downloadCsv(getCsvRef.current(), session.name); setMenuOpen(false); }}>Table — CSV</button>
                <button className="px-3 py-1.5 text-left hover:bg-forest-800 transition-colors" onClick={() => { exportTablePng(); setMenuOpen(false); }}>Table — PNG</button>
                <button className="px-3 py-1.5 text-left hover:bg-forest-800 transition-colors disabled:opacity-50" disabled={busy} onClick={() => { exportTableXlsx(); setMenuOpen(false); }}>Table — XLSX</button>
                {hasSubPlots() && (
                  <button className="px-3 py-1.5 text-left hover:bg-forest-800 transition-colors border-t border-forest-700 mt-1 pt-1.5" onClick={() => { exportSubPlots(); setMenuOpen(false); }}>Plots — PNG</button>
                )}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => downloadCsv(getCsvRef.current(), session.name)}
            onMouseDown={e => e.stopPropagation()}
            title="Download CSV"
            className="shrink-0 text-forest-600 hover:text-forest-300 transition-colors cursor-pointer"
          >
            <Download size={13} />
          </button>
        )}

        {!fsMode && (
          <button
            onClick={onToggleCollapse}
            onMouseDown={e => e.stopPropagation()}
            className="shrink-0 text-forest-600 hover:text-forest-300 transition-colors cursor-pointer"
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? <Plus size={13} /> : <Minus size={13} />}
          </button>
        )}

        <button
          onClick={fsMode ? () => setFullscreen(false) : () => setFullscreen(true)}
          onMouseDown={e => e.stopPropagation()}
          className="shrink-0 text-forest-600 hover:text-forest-300 transition-colors cursor-pointer"
          title={fsMode ? "Exit fullscreen" : "Fullscreen"}
        >
          {fsMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>

        <button
          onClick={onRemove}
          onMouseDown={e => e.stopPropagation()}
          className="shrink-0 text-forest-600 hover:text-red-400 transition-colors cursor-pointer"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  const inner = (
    <>
      {!file && (
        <div className="flex-1 flex items-center justify-center text-forest-500 text-sm">File not found</div>
      )}
      {file && isCV  && <CVAnalysisPanel  file={file} files={files} getCsvRef={getCsvRef} getPlotRef={getPlotRef} getMetricRowsRef={getMetricRowsRef} />}
      {file && isEIS && <EISAnalysisPanel file={file} getCsvRef={getCsvRef} />}
      {file && isGCD && <GCDAnalysisPanel file={file} getCsvRef={getCsvRef} />}
    </>
  );

  return (
    <>
      <div className={`h-full flex flex-col bg-forest-800 rounded-xl overflow-hidden border border-forest-700 ${etype ? (TYPE_BORDER[etype] ?? "") : ""}`}>
        {renderHeader(false)}
        {!isCollapsed && !fullscreen && inner}
      </div>
      {fullscreen && (
        <FullscreenOverlay onClose={() => setFullscreen(false)}>
          <div className="flex flex-col h-full bg-forest-800">
            {renderHeader(true)}
            {inner}
          </div>
        </FullscreenOverlay>
      )}
    </>
  );
}

export default React.memo(AnalysisPanel, (prev, next) =>
  prev.session === next.session && prev.files === next.files && prev.isCollapsed === next.isCollapsed
);
