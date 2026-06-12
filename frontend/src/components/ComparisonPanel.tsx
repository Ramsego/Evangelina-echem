import React, { useState, useRef, useEffect } from "react";
import { GripHorizontal, X, Download, Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import { ParsedFile, ComparisonSession } from "../types";
import { useExportContext, ExportFmt } from "../context/ExportContext";
import { buildZip } from "../utils/exportUtils";
import CVComparePanel  from "./panels/CVComparePanel";
import EISComparePanel from "./panels/EISComparePanel";
import GCDComparePanel from "./panels/GCDComparePanel";
import FullscreenOverlay from "./FullscreenOverlay";

const TYPE_LABEL: Record<string, string> = {
  CV: "CV Compare", LSV: "CV Compare",
  EISPOT: "EIS Compare",
  CHRONOP: "GCD Compare", PWR800_CYCLICCHARGEDISCHARGE: "GCD Compare",
};
const TYPE_COLOR: Record<string, string> = {
  CV: "bg-forest-700/50 text-forest-300", LSV: "bg-forest-700/50 text-forest-300",
  EISPOT: "bg-forest-600/40 text-forest-200",
  CHRONOP: "bg-forest-700/50 text-forest-300", PWR800_CYCLICCHARGEDISCHARGE: "bg-forest-700/50 text-forest-300",
};

interface HeaderProps {
  comparison: ComparisonSession;
  onRemove: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onFullscreen: () => void;
  isFullscreen?: boolean;
  onRename: (patch: Partial<ComparisonSession>) => void;
}

function ComparisonHeader({ comparison, onRemove, isCollapsed, onToggleCollapse, onFullscreen, isFullscreen, onRename }: HeaderProps) {
  const { exportOne, collectOne } = useExportContext();
  const [open,      setOpen]      = useState(false);
  const [fmts,      setFmts]      = useState<Set<ExportFmt>>(new Set());
  const [filename,  setFilename]  = useState(comparison.name);
  const [exporting, setExporting] = useState(false);
  const [editing,   setEditing]   = useState(false);
  const [draft,     setDraft]     = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const label = comparison.etype ? (TYPE_LABEL[comparison.etype] ?? "Compare") : "Compare";
  const color = comparison.etype ? (TYPE_COLOR[comparison.etype] ?? "bg-slate-700 text-slate-400") : "bg-slate-700 text-slate-400";

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function toggleFmt(f: ExportFmt) {
    setFmts(prev => { const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n; });
  }

  async function handleDownload() {
    const fmtList = [...fmts] as Array<"png" | "svg" | "csv">;
    if (fmtList.length === 0) return;
    setExporting(true);
    try {
      if (fmtList.length === 1) {
        exportOne(comparison.id, fmtList[0]);
      } else {
        const entry = collectOne(comparison.id);
        if (entry) await buildZip([entry], fmtList, filename || comparison.name);
      }
    } finally {
      setExporting(false);
      setOpen(false);
    }
  }

  return (
    <div className="drag-handle flex items-center gap-2 px-3 py-2 bg-forest-850 border-b border-forest-700 cursor-grab active:cursor-grabbing select-none">
      <GripHorizontal size={13} className="text-forest-600 shrink-0" />

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { onRename({ name: draft.trim() || comparison.name }); setEditing(false); }}
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
          onDoubleClick={() => { setDraft(comparison.name); setEditing(true); }}
          onMouseDown={e => e.stopPropagation()}
          title="Double-click to rename"
        >
          {comparison.name}
        </span>
      )}

      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${color}`}>{label}</span>

      <div ref={wrapperRef} className="relative shrink-0" onMouseDown={e => e.stopPropagation()}>
        <button onClick={() => setOpen(o => !o)}
                className="text-forest-600 hover:text-forest-300 transition-colors cursor-pointer" title="Export">
          <Download size={13} />
        </button>
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
            <input type="text" value={filename} onChange={e => setFilename(e.target.value)}
                   className="w-full text-[10px] bg-forest-800 border border-forest-600 rounded px-1.5 py-0.5 text-forest-200 mb-2 outline-none focus:border-forest-400" />
            <button onClick={handleDownload} disabled={fmts.size === 0 || exporting}
                    className="w-full text-[10px] bg-forest-700 hover:bg-forest-600 text-forest-100 rounded px-2 py-1 disabled:opacity-40 transition-colors cursor-pointer">
              {exporting ? "Exporting…" : fmts.size >= 2 ? "Download ZIP" : "Download"}
            </button>
          </div>
        )}
      </div>

      {!isFullscreen && (
        <button onClick={onToggleCollapse} onMouseDown={e => e.stopPropagation()}
                className="shrink-0 text-forest-600 hover:text-forest-300 transition-colors cursor-pointer"
                title={isCollapsed ? "Expand" : "Collapse"}>
          {isCollapsed ? <Plus size={13} /> : <Minus size={13} />}
        </button>
      )}

      <button onClick={onFullscreen} onMouseDown={e => e.stopPropagation()}
              className="shrink-0 text-forest-600 hover:text-forest-300 transition-colors cursor-pointer"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
        {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>

      <button onClick={onRemove} onMouseDown={e => e.stopPropagation()}
              className="shrink-0 text-forest-600 hover:text-red-400 transition-colors cursor-pointer">
        <X size={13} />
      </button>
    </div>
  );
}

interface Props {
  comparison: ComparisonSession;
  files: ParsedFile[];
  onRemove: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onRename: (patch: Partial<ComparisonSession>) => void;
}

function ComparisonPanel({ comparison, files, onRemove, isCollapsed, onToggleCollapse, onRename }: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  const isCV  = comparison.etype === "CV" || comparison.etype === "LSV";
  const isEIS = comparison.etype === "EISPOT";
  const isGCD = comparison.etype === "CHRONOP" || comparison.etype === "PWR800_CYCLICCHARGEDISCHARGE";

  const inner = (
    <>
      {isCV  && <CVComparePanel  comparison={comparison} files={files} />}
      {isEIS && <EISComparePanel comparison={comparison} files={files} />}
      {isGCD && <GCDComparePanel comparison={comparison} files={files} />}
    </>
  );

  return (
    <>
      <div className="h-full flex flex-col bg-forest-800 rounded-xl overflow-hidden border border-forest-700">
        <ComparisonHeader comparison={comparison} onRemove={onRemove}
                          isCollapsed={isCollapsed} onToggleCollapse={onToggleCollapse}
                          onFullscreen={() => setFullscreen(true)} onRename={onRename} />
        {!isCollapsed && !fullscreen && inner}
      </div>
      {fullscreen && (
        <FullscreenOverlay onClose={() => setFullscreen(false)}>
          <div className="flex flex-col h-full bg-forest-800">
            <ComparisonHeader comparison={comparison} onRemove={onRemove}
                              isCollapsed={false} onToggleCollapse={() => {}}
                              onFullscreen={() => setFullscreen(false)} isFullscreen onRename={onRename} />
            {inner}
          </div>
        </FullscreenOverlay>
      )}
    </>
  );
}

export default React.memo(ComparisonPanel, (prev, next) =>
  prev.comparison === next.comparison && prev.files === next.files && prev.isCollapsed === next.isCollapsed
);
