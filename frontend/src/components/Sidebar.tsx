import { useCallback, useState, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation } from "@tanstack/react-query";
import { FlaskConical, Upload, X, Loader2, ChevronDown, ChevronRight, Download, AlertTriangle, Github } from "lucide-react";
import { ParsedFile, ComparisonSession, AnalysisSession, FileSelection, EType } from "../types";
import { fetchSample, uploadFiles } from "../api/client";
import { useFileLabels } from "../context/FileLabelContext";
import { StyleSettings, PALETTES, FRAMEWORKS, FONT_FAMILIES, MARKER_SHAPES, DEFAULT_STYLE } from "../styles/styleTypes";
import { useExportContext, ExportFmt } from "../context/ExportContext";
import { buildZip } from "../utils/exportUtils";
import { useStyleContext } from "../context/StyleContext";
import { useTheme, UITheme } from "../context/ThemeContext";
import { APP_NAME } from "../constants";
import clsx from "clsx";

const ETYPE_DOT: Record<string, string> = {
  CV:      "bg-forest-600",
  LSV:     "bg-forest-600",
  EISPOT:  "bg-forest-500",
  CHRONOP: "bg-forest-700",
  PWR800_CYCLICCHARGEDISCHARGE: "bg-forest-700",
  SEESAW:  "bg-amber-500",
};

const ETYPE_GROUP_LABEL: Record<string, string> = {
  CV:      "CV / LSV",
  EISPOT:  "EIS",
  CHRONOP: "GCD",
};

interface Props {
  files:              ParsedFile[];
  comparisons:        ComparisonSession[];
  onFilesAdded:       (files: ParsedFile[]) => void;
  onFileRemoved:      (id: string) => void;
  onComparisonAdded:  (c: ComparisonSession) => void;
  onAnalysisAdded:    (a: AnalysisSession) => void;
}

function SectionToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className="w-full flex items-center justify-between py-1 text-[10px] font-semibold text-sidebar-muted uppercase tracking-wider">
      {label}
      {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-sidebar-text">
      <span className="shrink-0">{label}</span>
      {children}
    </div>
  );
}

const CTL = "bg-white/60 border border-gray-400/60 rounded px-1 py-0.5 text-gray-900 text-[11px]";

interface SliderProps {
  min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
  disabled?: boolean; className?: string;
}
function StyleSlider({ value, onChange, disabled, className, ...rest }: SliderProps) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <input
      type="range"
      value={local}
      disabled={disabled}
      onChange={e => setLocal(Number(e.target.value))}
      onPointerUp={e => onChange(Number((e.target as HTMLInputElement).value))}
      className={className}
      {...rest}
    />
  );
}

const ANALYSABLE_ETYPES = new Set(["CV", "LSV", "EISPOT", "CHRONOP", "PWR800_CYCLICCHARGEDISCHARGE"]);

export default function Sidebar({ files, comparisons, onFilesAdded, onFileRemoved, onComparisonAdded, onAnalysisAdded }: Props) {
  const { theme, setTheme } = useTheme();
  const { getLabel } = useFileLabels();
  const { exportAll, collectAll } = useExportContext();
  const { globalStyle, panelStyles, selectedId, setGlobal, setPanel, clearPanel, legendAutoSizes } = useStyleContext();
  const editingStyle   = selectedId ? { ...globalStyle, ...(panelStyles[selectedId] ?? {}) } : globalStyle;
  const updateStyle    = (s: StyleSettings) => {
    if (selectedId) { setPanel(selectedId, s); return; }
    // A global style choice pins the framework so theme switches no longer override it.
    localStorage.setItem("app.styleFrameworkPinned", "true");
    setGlobal(s);
  };
  const selectedFile   = selectedId ? files.find(f => f.id === selectedId) : null;
  const selectedAutoLegendSize = selectedId ? legendAutoSizes[selectedId] : undefined;
  const [showColorEditor, setShowColorEditor] = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [exportOpen,  setExportOpen]  = useState(false);
  const [exportFmts,  setExportFmts]  = useState<Set<ExportFmt>>(new Set());
  const [zipName,     setZipName]     = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const exportWrapRef = useRef<HTMLDivElement>(null);

  // ── Compare state ────────────────────────────────────────────────────────
  const [compareTarget,  setCompareTarget]  = useState<string | null>(null);
  const [compareChecked, setCompareChecked] = useState<Set<string>>(new Set());
  const [compareCycles,  setCompareCycles]  = useState<Record<string, number>>({});
  const [compareName,    setCompareName]    = useState("");

  // Group files by canonical etype (CV+LSV → "CV", PWR800 → "CHRONOP")
  const etypeGroups: Record<string, ParsedFile[]> = {};
  files.forEach(f => {
    if (!f.etype) return;
    const key = f.etype === "LSV" ? "CV"
              : f.etype === "PWR800_CYCLICCHARGEDISCHARGE" ? "CHRONOP"
              : f.etype;
    if (key === "CV" || key === "EISPOT" || key === "CHRONOP") {
      (etypeGroups[key] ??= []).push(f);
    }
  });
  const comparableGroups = Object.entries(etypeGroups).filter(([, g]) => g.length >= 2);

  function openCompareFor(key: string, groupFiles: ParsedFile[]) {
    setCompareTarget(key);
    setCompareChecked(new Set(groupFiles.map(f => f.id)));
    setCompareCycles(Object.fromEntries(groupFiles.map(f => [f.id, 1])));
    const existing = comparisons.filter(c =>
      key === "CV"      ? (c.etype === "CV" || c.etype === "LSV") :
      key === "CHRONOP" ? (c.etype === "CHRONOP" || c.etype === "PWR800_CYCLICCHARGEDISCHARGE") :
      c.etype === key
    ).length;
    setCompareName(`${ETYPE_GROUP_LABEL[key] ?? key} Comparison ${existing + 1}`);
  }

  // ── Quick compare (checkboxes in the file list) ─────────────────────────
  const [quickChecked, setQuickChecked] = useState<Set<string>>(new Set());

  const groupKeyOf = (f: ParsedFile): string | null => {
    if (!f.etype || f.error) return null;
    const key = f.etype === "LSV" ? "CV"
              : f.etype === "PWR800_CYCLICCHARGEDISCHARGE" ? "CHRONOP"
              : f.etype;
    return (key === "CV" || key === "EISPOT" || key === "CHRONOP") ? key : null;
  };

  function toggleQuickCheck(f: ParsedFile) {
    const key = groupKeyOf(f);
    if (!key) return;
    setQuickChecked(prev => {
      if (prev.has(f.id)) {
        const next = new Set(prev);
        next.delete(f.id);
        return next;
      }
      // Checking a file from a different group resets the selection to just it
      const checkedGroup = [...prev].map(id => {
        const cf = files.find(x => x.id === id);
        return cf ? groupKeyOf(cf) : null;
      })[0];
      if (checkedGroup && checkedGroup !== key) return new Set([f.id]);
      return new Set([...prev, f.id]);
    });
  }

  function handleQuickCompare() {
    const checkedFiles = files.filter(f => quickChecked.has(f.id));
    if (checkedFiles.length < 2) return;
    const key = groupKeyOf(checkedFiles[0]);
    if (!key) return;
    const existing = comparisons.filter(c =>
      key === "CV"      ? (c.etype === "CV" || c.etype === "LSV") :
      key === "CHRONOP" ? (c.etype === "CHRONOP" || c.etype === "PWR800_CYCLICCHARGEDISCHARGE") :
      c.etype === key
    ).length;
    onComparisonAdded({
      id:         `cmp-${Date.now()}`,
      name:       `${ETYPE_GROUP_LABEL[key] ?? key} Comparison ${existing + 1}`,
      etype:      key as EType,
      selections: checkedFiles.map(f => ({ fileId: f.id, curveIndex: 1 })),
    });
    setQuickChecked(new Set());
  }

  function handleAddComparison() {
    if (!compareTarget) return;
    const groupFiles  = etypeGroups[compareTarget] ?? [];
    const checkedFiles = groupFiles.filter(f => compareChecked.has(f.id));
    if (checkedFiles.length < 2) return;
    const selections: FileSelection[] = checkedFiles.map(f => ({
      fileId:     f.id,
      curveIndex: compareTarget === "CV" ? (compareCycles[f.id] ?? 1) : 1,
    }));
    onComparisonAdded({
      id:         `cmp-${Date.now()}`,
      name:       compareName || `${ETYPE_GROUP_LABEL[compareTarget] ?? compareTarget} Comparison`,
      etype:      compareTarget as EType,
      selections,
    });
    setCompareTarget(null);
  }

  useEffect(() => {
    if (!exportOpen) return;
    function handle(e: MouseEvent) {
      if (exportWrapRef.current && !exportWrapRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [exportOpen]);

  function toggleExportFmt(f: ExportFmt) {
    setExportFmts(prev => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  }

  async function handleExportAll() {
    const fmtList = [...exportFmts] as Array<"png" | "svg" | "csv">;
    if (fmtList.length === 0) return;
    setIsExporting(true);
    try {
      if (fmtList.length === 1) {
        exportAll(fmtList[0]);
      } else {
        const entries = collectAll();
        const defaultName = files[0]?.name.replace(/\.dta$/i, '') ?? "export";
        await buildZip(entries, fmtList, zipName || defaultName, globalStyle.exportShape);
      }
    } finally {
      setIsExporting(false);
      setExportOpen(false);
    }
  }
  const [styleOpen,   setStyleOpen]   = useState(true);
  const [openSec,     setOpenSec]     = useState<Record<string, boolean>>({
    lines: true, axes: false, grid: false, text: false, legend: false,
  });

  const toggle = (k: string) => setOpenSec(p => ({ ...p, [k]: !p[k] }));

  const set = <K extends keyof StyleSettings>(key: K, val: StyleSettings[K]) =>
    updateStyle({ ...editingStyle, [key]: val, framework: "Custom" });

  const applyFramework = (name: string) => {
    if (FRAMEWORKS[name]) updateStyle({ ...DEFAULT_STYLE, ...FRAMEWORKS[name], framework: name });
  };

  const uploadMut = useMutation({
    mutationFn: uploadFiles,
    onSuccess: (data) => { onFilesAdded(data); setError(null); },
    onError:   (e: Error) => setError(e.message),
  });

  const sampleMut = useMutation({
    mutationFn: fetchSample,
    onSuccess: (data) => { onFilesAdded(data); setError(null); },
    onError:   (e: Error) => setError(e.message),
  });

  const onDrop = useCallback((accepted: File[]) => {
    const dta = accepted.filter(f => f.name.toLowerCase().endsWith(".dta"));
    if (dta.length) uploadMut.mutate(dta);
  }, [uploadMut]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { "application/octet-stream": [".dta"] }, multiple: true,
  });

  const busy = uploadMut.isPending || sampleMut.isPending;

  return (
    <aside
      className="w-64 shrink-0 flex flex-col border-r border-gray-300/60 overflow-hidden"
      style={{ background: "var(--sidebar-bg)" }}
    >
      <div className="flex-1 overflow-y-auto">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-sidebar-border">
        <FlaskConical size={18} className="text-sidebar-text shrink-0" />
        <span className="font-bold text-sidebar-text text-sm tracking-tight">{APP_NAME}</span>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {/* Dropzone */}
        <div {...getRootProps()} className={clsx(
          "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-3 py-5 cursor-pointer transition-colors",
          isDragActive
            ? "border-forest-600 bg-white/30"
            : "border-gray-400/60 hover:border-forest-600 hover:bg-white/20"
        )}>
          <input {...getInputProps()} />
          {busy
            ? <Loader2 size={20} className="text-sidebar-text animate-spin" />
            : <Upload size={20} className="text-sidebar-text" />}
          <p className="text-xs text-sidebar-text text-center leading-relaxed">
            {isDragActive ? "Drop .dta files here" : "Drop .dta files\nor click to browse"}
          </p>
        </div>

        {files.length === 0 && (
          <div className="rounded-lg overflow-hidden border border-gray-400/40">
            <img src="/demo.gif" alt="App demo" className="w-full block" />
          </div>
        )}

        {error && (
          <p className="text-xs text-red-700 bg-red-50/80 border border-red-300 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="flex flex-col border-t border-sidebar-border">
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-[11px] font-semibold text-sidebar-muted uppercase tracking-wider">
              Loaded ({files.length})
            </span>
            <div className="flex items-center gap-2">
              {/* Export all dropdown */}
              <div ref={exportWrapRef} className="relative">
                <button
                  onClick={() => setExportOpen(o => !o)}
                  className="flex items-center gap-0.5 text-[10px] text-sidebar-muted hover:text-sidebar-text transition-colors"
                  title="Export all panels"
                >
                  <Download size={10} />
                  All
                </button>
                {exportOpen && (
                  <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-300 rounded shadow-lg p-2.5 min-w-[170px]">
                    <div className="flex gap-3 mb-2">
                      {(["png", "svg", "csv"] as ExportFmt[]).map(f => (
                        <label key={f} className="flex items-center gap-1 cursor-pointer text-[11px] text-gray-700 select-none">
                          <input type="checkbox" checked={exportFmts.has(f)} onChange={() => toggleExportFmt(f)} className="accent-forest-600" />
                          {f.toUpperCase()}
                        </label>
                      ))}
                    </div>
                    {exportFmts.size >= 2 && (
                      <input
                        type="text"
                        placeholder={files[0]?.name.replace(/\.dta$/i, '') ?? "export"}
                        value={zipName}
                        onChange={e => setZipName(e.target.value)}
                        className="w-full text-[10px] bg-white border border-gray-300 rounded px-1.5 py-0.5 text-gray-700 mb-2 outline-none focus:border-forest-400"
                      />
                    )}
                    <button
                      onClick={handleExportAll}
                      disabled={exportFmts.size === 0 || isExporting}
                      className="w-full text-[10px] bg-forest-600 hover:bg-forest-700 text-white rounded px-2 py-1 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      {isExporting ? "Exporting…" : exportFmts.size >= 2 ? "Export ZIP" : "Export all"}
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => files.forEach(f => onFileRemoved(f.id))}
                className="text-[10px] text-sidebar-muted hover:text-red-600 transition-colors"
              >
                Clear all
              </button>
            </div>
          </div>
          <ul className="flex flex-col gap-0.5 px-2 pb-4">
            {files.map(f => (
              <li key={f.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/8 transition-colors group">
                {groupKeyOf(f) && (
                  <input
                    type="checkbox"
                    checked={quickChecked.has(f.id)}
                    onChange={() => toggleQuickCheck(f)}
                    title="Select for comparison"
                    className={clsx(
                      "accent-forest-600 shrink-0 transition-opacity cursor-pointer",
                      quickChecked.has(f.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}
                  />
                )}
                {f.error ? (
                  <span title={f.error} className="shrink-0 flex items-center">
                    <AlertTriangle size={10} className="text-red-400" />
                  </span>
                ) : (
                  <span className={clsx(
                    "w-2 h-2 rounded-full shrink-0",
                    f.etype ? (ETYPE_DOT[f.etype] ?? "bg-gray-500") : "bg-gray-500"
                  )} />
                )}
                <span className={clsx("text-xs truncate flex-1", f.error ? "text-red-400" : "text-sidebar-text")}>
                  {getLabel(f.id, f.name)}
                </span>
                <button onClick={() => onFileRemoved(f.id)}
                  className="opacity-0 group-hover:opacity-100 text-sidebar-muted hover:text-red-600 transition-all">
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
          {quickChecked.size >= 2 && (
            <div className="sticky bottom-0 flex items-center gap-2 px-4 py-2 bg-sidebar-bg border-t border-sidebar-border">
              <button
                onClick={handleQuickCompare}
                className="flex-1 text-[11px] bg-forest-600 hover:bg-forest-700 text-white rounded px-2 py-1 transition-colors cursor-pointer"
              >
                Compare ({quickChecked.size}) ▸
              </button>
              <button
                onClick={() => setQuickChecked(new Set())}
                className="text-sidebar-muted hover:text-red-600 transition-colors"
                title="Clear selection"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Compare ─────────────────────────────────────────────────────────── */}
      {comparableGroups.length > 0 && (
        <div className="border-t border-sidebar-border px-4 py-3 flex flex-col gap-3">
          <span className="text-[11px] font-semibold text-sidebar-muted uppercase tracking-wider">Compare</span>
          {comparableGroups.map(([key, groupFiles]) => (
            <div key={key} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-sidebar-text">
                  {ETYPE_GROUP_LABEL[key] ?? key}
                  <span className="text-sidebar-muted text-[10px] ml-1">({groupFiles.length})</span>
                </span>
                <button
                  onClick={() => compareTarget === key ? setCompareTarget(null) : openCompareFor(key, groupFiles)}
                  className="text-[10px] text-[color:var(--sidebar-accent)] border border-[color:var(--sidebar-accent-border)] rounded px-1.5 py-0.5 hover:bg-[color:var(--sidebar-accent-hover)] transition-colors"
                >
                  {compareTarget === key ? "✕" : "Compare ▸"}
                </button>
              </div>

              {compareTarget === key && (
                <div className="flex flex-col gap-2 pl-2 border-l-2 border-forest-300/40">
                  {/* File rows with cycle inputs for CV */}
                  {groupFiles.map(f => (
                    <div key={f.id} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={compareChecked.has(f.id)}
                        onChange={() => setCompareChecked(prev => {
                          const next = new Set(prev);
                          next.has(f.id) ? next.delete(f.id) : next.add(f.id);
                          return next;
                        })}
                        className="accent-forest-600 shrink-0"
                      />
                      <span className="text-[10px] text-sidebar-text truncate flex-1 min-w-0">
                        {getLabel(f.id, f.name)}
                      </span>
                      {key === "CV" && (f.curves?.length ?? 0) > 1 && (
                        <label className="flex items-center gap-0.5 text-[10px] text-sidebar-muted shrink-0">
                          C
                          <input
                            type="number"
                            value={compareCycles[f.id] ?? 1}
                            min={1}
                            max={f.curves?.length ?? 1}
                            disabled={!compareChecked.has(f.id)}
                            onChange={e => setCompareCycles(prev => ({
                              ...prev,
                              [f.id]: Math.min(Math.max(1, Number(e.target.value)), f.curves?.length ?? 1),
                            }))}
                            className="w-8 bg-white border border-gray-300 rounded px-0.5 py-0.5 text-[10px] text-gray-900 disabled:opacity-40"
                          />
                        </label>
                      )}
                    </div>
                  ))}

                  <input
                    type="text"
                    value={compareName}
                    onChange={e => setCompareName(e.target.value)}
                    placeholder="Session name"
                    className="text-[10px] bg-white border border-gray-300 rounded px-1.5 py-0.5 text-gray-700 outline-none focus:border-forest-400"
                  />
                  <button
                    onClick={handleAddComparison}
                    disabled={compareChecked.size < 2}
                    className="text-[10px] bg-forest-600 hover:bg-forest-700 text-white rounded px-2 py-1 disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    Add panel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Analyse ─────────────────────────────────────────────────────────── */}
      {files.some(f => f.etype && ANALYSABLE_ETYPES.has(f.etype)) && (
        <div className="border-t border-sidebar-border px-4 py-3 flex flex-col gap-2">
          <span className="text-[11px] font-semibold text-sidebar-muted uppercase tracking-wider">Analyse</span>
          {files.filter(f => f.etype && ANALYSABLE_ETYPES.has(f.etype)).map(f => (
            <div key={f.id} className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-sidebar-text truncate flex-1 min-w-0">{getLabel(f.id, f.name)}</span>
              <button
                onClick={() => onAnalysisAdded({
                  id:     `ana-${f.id}`,
                  name:   `${getLabel(f.id, f.name)} Analysis`,
                  fileId: f.id,
                })}
                className="text-[10px] text-[color:var(--sidebar-accent)] border border-[color:var(--sidebar-accent-border)] rounded px-1.5 py-0.5 hover:bg-[color:var(--sidebar-accent-hover)] transition-colors shrink-0"
              >
                Analyse ▸
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Graph Style ─────────────────────────────────────────────────────── */}
      <div className="border-t border-sidebar-border px-4 py-3 flex flex-col gap-3">
        <button onClick={() => setStyleOpen(o => !o)}
          className="w-full flex items-center justify-between text-[11px] font-bold text-sidebar-text uppercase tracking-wider">
          <span className="flex flex-col items-start gap-0.5">
            <span>Graph Style</span>
            {selectedFile
              ? <span className="text-[9px] font-normal text-forest-600 normal-case tracking-normal truncate max-w-[160px]">{selectedFile.name}</span>
              : <span className="text-[9px] font-normal text-sidebar-muted normal-case tracking-normal">all panels</span>}
          </span>
          {styleOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        {styleOpen && (
          <div className="flex flex-col gap-3">

            {/* Framework */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-sidebar-muted uppercase tracking-wider">Framework</span>
              <select value={editingStyle.framework} onChange={e => applyFramework(e.target.value)} className={CTL + " w-full"}>
                {Object.keys(FRAMEWORKS).map(k => <option key={k}>{k}</option>)}
                {editingStyle.framework === "Custom" && <option value="Custom">Custom</option>}
              </select>
            </div>

            {/* Color scheme + swatch editor */}
            <div className="flex flex-col gap-1">
              <Row label="Colors">
                <select value={editingStyle.colorScheme} onChange={e => { set("colorScheme", e.target.value); updateStyle({ ...editingStyle, colorScheme: e.target.value, customPalette: undefined, framework: "Custom" }); }} className={CTL + " flex-1"}>
                  {Object.keys(PALETTES).map(k => <option key={k}>{k}</option>)}
                </select>
              </Row>
              {/* Active palette preview bar */}
              {(() => {
                const activePalette = editingStyle.customPalette ?? PALETTES[editingStyle.colorScheme] ?? PALETTES["Forest"];
                return (
                  <>
                    <div className="flex gap-0.5 rounded overflow-hidden h-3">
                      {activePalette.map((c, i) => (
                        <div key={i} className="flex-1" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <button
                        onClick={() => setShowColorEditor(v => !v)}
                        className="text-[10px] text-sidebar-muted hover:text-sidebar-text transition-colors"
                      >{showColorEditor ? "▴ Hide colours" : "▾ Edit colours"}</button>
                      {editingStyle.customPalette && (
                        <button
                          onClick={() => updateStyle({ ...editingStyle, customPalette: undefined })}
                          className="text-[10px] text-red-400 hover:text-red-500 transition-colors"
                        >Reset</button>
                      )}
                    </div>
                    {showColorEditor && (
                      <div className="grid grid-cols-4 gap-1.5 mt-1">
                        {activePalette.map((c, i) => (
                          <div key={i} className="flex flex-col items-center gap-0.5">
                            <label className="relative cursor-pointer block w-8 h-8">
                              <div className="w-8 h-8 rounded border border-sidebar-border" style={{ backgroundColor: c }} />
                              <input
                                type="color"
                                value={c}
                                onChange={e => {
                                  const next = [...activePalette];
                                  next[i] = e.target.value;
                                  updateStyle({ ...editingStyle, customPalette: next, framework: "Custom" });
                                }}
                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                              />
                            </label>
                            <span className="text-[9px] text-sidebar-muted font-mono leading-none">{c.slice(1).toUpperCase()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* ── Lines & Markers ── */}
            <div className="flex flex-col gap-1.5">
              <SectionToggle label="Lines & Markers" open={openSec.lines} onToggle={() => toggle("lines")} />
              {openSec.lines && (
                <div className="flex flex-col gap-2">
                  <Row label="Width">
                    <StyleSlider min={0.5} max={6} step={0.5} value={editingStyle.lineWidth}
                      onChange={v => set("lineWidth", v)}
                      className="flex-1 accent-forest-600" />
                    <span className="w-6 text-right text-sidebar-muted text-[11px]">{editingStyle.lineWidth}</span>
                  </Row>
                  <Row label="Style">
                    <select value={editingStyle.lineDash} onChange={e => set("lineDash", e.target.value as StyleSettings["lineDash"])} className={CTL + " flex-1"}>
                      <option value="solid">Solid</option>
                      <option value="dash">Dashed</option>
                      <option value="dot">Dotted</option>
                      <option value="dashdot">Dash-dot</option>
                    </select>
                  </Row>
                  <Row label="Markers">
                    <input type="checkbox" checked={editingStyle.showMarkers} onChange={e => set("showMarkers", e.target.checked)} className="accent-forest-600" />
                    <span className="flex-1 text-sidebar-muted pl-1 text-[11px]">Size</span>
                    <StyleSlider min={2} max={18} step={1} value={editingStyle.markerSize}
                      disabled={!editingStyle.showMarkers}
                      onChange={v => set("markerSize", v)}
                      className="w-16 accent-forest-600 disabled:opacity-30" />
                    <span className="w-5 text-right text-sidebar-muted text-[11px]">{editingStyle.markerSize}</span>
                  </Row>
                  <Row label="Shape">
                    <select value={editingStyle.markerShape}
                      onChange={e => set("markerShape", e.target.value)}
                      disabled={!editingStyle.showMarkers}
                      className={CTL + " flex-1 disabled:opacity-30"}>
                      {Object.entries(MARKER_SHAPES).map(([label, val]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </Row>
                </div>
              )}
            </div>

            {/* ── Axes ── */}
            <div className="flex flex-col gap-1.5">
              <SectionToggle label="Axes" open={openSec.axes} onToggle={() => toggle("axes")} />
              {openSec.axes && (
                <div className="flex flex-col gap-2">
                  <Row label="Mirror">
                    <input type="checkbox" checked={editingStyle.mirrorAxes} onChange={e => set("mirrorAxes", e.target.checked)} className="accent-forest-600" />
                  </Row>
                  <Row label="Ticks">
                    <div className="flex gap-3">
                      {(["outside","inside"] as const).map(v => (
                        <label key={v} className="flex items-center gap-1 cursor-pointer">
                          <input type="radio" name="ticks" checked={editingStyle.tickDirection === v} onChange={() => set("tickDirection", v)} className="accent-forest-600" />
                          <span className="text-[11px] text-sidebar-text capitalize">{v}</span>
                        </label>
                      ))}
                    </div>
                  </Row>
                  <Row label="Axis color">
                    <input type="color" value={editingStyle.axisLineColor} onChange={e => set("axisLineColor", e.target.value)} className="w-7 h-5 rounded cursor-pointer border border-gray-300" />
                    <span className="flex-1 text-sidebar-muted pl-1 text-[11px]">Width</span>
                    <StyleSlider min={0.5} max={4} step={0.5} value={editingStyle.axisLineWidth}
                      onChange={v => set("axisLineWidth", v)}
                      className="w-14 accent-forest-600" />
                    <span className="w-5 text-right text-sidebar-muted text-[11px]">{editingStyle.axisLineWidth}</span>
                  </Row>
                  <Row label="Background">
                    <input type="color" value={editingStyle.plotBgColor} onChange={e => set("plotBgColor", e.target.value)} className="w-7 h-5 rounded cursor-pointer border border-gray-300" />
                  </Row>
                  <Row label="Border">
                    <input type="checkbox" checked={editingStyle.showBorder} onChange={e => set("showBorder", e.target.checked)} className="accent-forest-600" />
                  </Row>
                  <Row label="Export shape">
                    <select value={editingStyle.exportShape} onChange={e => set("exportShape", e.target.value as StyleSettings["exportShape"])} className={CTL + " flex-1"}>
                      <option value="wide">Wide (4:3)</option>
                      <option value="square">Square (1:1)</option>
                    </select>
                  </Row>
                </div>
              )}
            </div>

            {/* ── Grid ── */}
            <div className="flex flex-col gap-1.5">
              <SectionToggle label="Grid" open={openSec.grid} onToggle={() => toggle("grid")} />
              {openSec.grid && (
                <div className="flex flex-col gap-2">
                  <Row label="X grid">
                    <input type="checkbox" checked={editingStyle.showXGrid} onChange={e => set("showXGrid", e.target.checked)} className="accent-forest-600" />
                    <span className="flex-1" />
                    <span className="text-sidebar-muted text-[11px]">Y grid</span>
                    <input type="checkbox" checked={editingStyle.showYGrid} onChange={e => set("showYGrid", e.target.checked)} className="accent-forest-600 ml-1" />
                  </Row>
                  <Row label="Color">
                    <input type="color" value={editingStyle.gridColor} onChange={e => set("gridColor", e.target.value)} className="w-7 h-5 rounded cursor-pointer border border-gray-300" />
                  </Row>
                  <Row label="Style">
                    <select value={editingStyle.gridLineStyle} onChange={e => set("gridLineStyle", e.target.value as StyleSettings["gridLineStyle"])} className={CTL + " flex-1"}>
                      <option value="solid">Solid</option>
                      <option value="dash">Dashed</option>
                      <option value="dot">Dotted</option>
                      <option value="dashdot">Dash-dot</option>
                    </select>
                  </Row>
                  <Row label="Width">
                    <StyleSlider min={0.5} max={3} step={0.5} value={editingStyle.gridLineWidth}
                      onChange={v => set("gridLineWidth", v)}
                      className="flex-1 accent-forest-600" />
                    <span className="w-5 text-right text-sidebar-muted text-[11px]">{editingStyle.gridLineWidth}</span>
                  </Row>
                </div>
              )}
            </div>

            {/* ── Text ── */}
            <div className="flex flex-col gap-1.5">
              <SectionToggle label="Text & Font" open={openSec.text} onToggle={() => toggle("text")} />
              {openSec.text && (
                <div className="flex flex-col gap-2">
                  <Row label="Font">
                    <select value={editingStyle.fontFamily} onChange={e => set("fontFamily", e.target.value)} className={CTL + " flex-1"}>
                      {Object.keys(FONT_FAMILIES).map(k => <option key={k}>{k}</option>)}
                    </select>
                  </Row>
                  <Row label="Body">
                    <StyleSlider min={8} max={20} step={1} value={editingStyle.fontSizeBody}
                      onChange={v => set("fontSizeBody", v)}
                      className="flex-1 accent-forest-600" />
                    <span className="w-5 text-right text-sidebar-muted text-[11px]">{editingStyle.fontSizeBody}</span>
                  </Row>
                  <Row label="Axis labels">
                    <StyleSlider min={8} max={24} step={1} value={editingStyle.axisLabelFontSize}
                      onChange={v => set("axisLabelFontSize", v)}
                      className="flex-1 accent-forest-600" />
                    <span className="w-5 text-right text-sidebar-muted text-[11px]">{editingStyle.axisLabelFontSize}</span>
                  </Row>
                  <Row label="Title">
                    <StyleSlider min={8} max={28} step={1} value={editingStyle.fontSizeTitle}
                      onChange={v => set("fontSizeTitle", v)}
                      className="flex-1 accent-forest-600" />
                    <span className="w-5 text-right text-sidebar-muted text-[11px]">{editingStyle.fontSizeTitle}</span>
                  </Row>
                </div>
              )}
            </div>

            {/* ── Legend ── */}
            <div className="flex flex-col gap-1.5">
              <SectionToggle label="Legend" open={openSec.legend} onToggle={() => toggle("legend")} />
              {openSec.legend && (
                <div className="flex flex-col gap-2">
                  <Row label="Show">
                    <input type="checkbox" checked={editingStyle.showLegend} onChange={e => set("showLegend", e.target.checked)} className="accent-forest-600" />
                  </Row>
                  <Row label="Place">
                    <div className="flex flex-wrap gap-1">
                      {([
                        { label: "↖", x: 0.01, y: 0.99, title: "Top-left" },
                        { label: "↗", x: 0.99, y: 0.99, title: "Top-right" },
                        { label: "↙", x: 0.01, y: 0.01, title: "Bottom-left" },
                        { label: "↘", x: 0.99, y: 0.01, title: "Bottom-right" },
                        { label: "Auto", x: null, y: null, title: "Auto (Plotly default)" },
                      ] as const).map(p => {
                        const isActive = p.x === null
                          ? editingStyle.legendX === 1.02 && editingStyle.legendY === 1
                          : Math.abs(editingStyle.legendX - p.x) < 0.02 && Math.abs(editingStyle.legendY - p.y) < 0.02;
                        return (
                          <button
                            key={p.label}
                            type="button"
                            title={p.title}
                            disabled={!editingStyle.showLegend}
                            onClick={() => { set("legendX", p.x ?? 1.02); set("legendY", p.y ?? 1); }}
                            className={clsx(
                              "px-2 py-0.5 rounded border text-[10px] transition-colors disabled:opacity-40",
                              isActive
                                ? "bg-forest-600 text-white border-forest-600"
                                : "bg-sidebar-bg text-sidebar-text border-sidebar-border hover:border-forest-500"
                            )}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </Row>
                  <Row label="Layout">
                    <div className="flex gap-3">
                      {(["v", "h"] as const).map(o => (
                        <label key={o} className="flex items-center gap-1 cursor-pointer">
                          <input type="radio" name="legendOrientation"
                            checked={editingStyle.legendOrientation === o}
                            onChange={() => set("legendOrientation", o)}
                            disabled={!editingStyle.showLegend}
                            className="accent-forest-600 disabled:opacity-40" />
                          <span className="text-[11px] text-sidebar-text">{o === "v" ? "Vertical" : "Horizontal"}</span>
                        </label>
                      ))}
                    </div>
                  </Row>
                  <Row label="Position">
                    <button
                      type="button"
                      disabled={!editingStyle.showLegend}
                      onClick={() => set("legendBelow", !editingStyle.legendBelow)}
                      className={clsx(
                        "px-2 py-0.5 rounded border text-[10px] transition-colors disabled:opacity-40",
                        editingStyle.legendBelow
                          ? "bg-forest-600 text-white border-forest-600"
                          : "border-gray-400/60 text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      ↓ Below plot
                    </button>
                  </Row>
                  <Row label="Size">
                    <div className="flex rounded overflow-hidden border border-gray-400/60">
                      {(["auto", "manual"] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          disabled={!editingStyle.showLegend}
                          onClick={() => set("legendFontSizeMode", mode)}
                          className={clsx(
                            "px-2 py-0.5 text-[10px] transition-colors disabled:opacity-40",
                            editingStyle.legendFontSizeMode === mode
                              ? "bg-forest-600 text-white"
                              : "bg-white/60 text-gray-700 hover:bg-gray-200"
                          )}
                        >
                          {mode === "auto" ? "Auto" : "Manual"}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row label="Font size">
                    <StyleSlider min={4} max={24} step={1} value={editingStyle.legendFontSize}
                      disabled={!editingStyle.showLegend || editingStyle.legendFontSizeMode === "auto"}
                      onChange={v => set("legendFontSize", v)}
                      className="flex-1 accent-forest-600 disabled:opacity-40" />
                    <span className="w-10 text-right text-sidebar-muted text-[11px]">
                      {editingStyle.legendFontSizeMode === "auto" ? (selectedAutoLegendSize ? `${selectedAutoLegendSize}px` : "Auto") : editingStyle.legendFontSize}
                    </span>
                  </Row>
                </div>
              )}
            </div>

            {selectedId && panelStyles[selectedId] && (
              <button onClick={() => clearPanel(selectedId)}
                className="text-[10px] text-amber-600 hover:text-amber-800 transition-colors text-left border-t border-sidebar-border/60 pt-2">
                ↺ Reset to global style
              </button>
            )}
            <button onClick={() => selectedId ? setPanel(selectedId, globalStyle) : setGlobal(DEFAULT_STYLE)}
              className="text-[10px] text-sidebar-muted hover:text-sidebar-text transition-colors text-left border-t border-sidebar-border/60 pt-2">
              ↺ Reset to defaults
            </button>

          </div>
        )}
      </div>
      </div>{/* end scrollable content */}

      {/* ── Theme switcher (footer) ──────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-2.5 border-t border-sidebar-border flex items-center gap-2">
        <span className="text-[10px] text-sidebar-muted uppercase tracking-wider flex-1">Theme</span>
        <a
          href="https://github.com/Ramsego/evangelina-echem"
          target="_blank"
          rel="noopener noreferrer"
          title="View source on GitHub"
          className="text-sidebar-muted hover:text-forest-400 transition-colors mr-1"
        >
          <Github size={14} />
        </a>
        {(["forest", "dark", "light", "blade"] as UITheme[]).map(t => (
          <button
            key={t}
            title={t.charAt(0).toUpperCase() + t.slice(1)}
            onClick={() => setTheme(t)}
            className={clsx(
              "w-4 h-4 rounded-full transition-all cursor-pointer shrink-0",
              theme === t
                ? "ring-2 ring-forest-400 scale-110"
                : "opacity-50 hover:opacity-90 hover:scale-105"
            )}
            style={{
              backgroundColor: t === "forest" ? "#1B4332" : t === "dark" ? "#0D1117" : t === "blade" ? "#140d1d" : "#F0F7F4",
              border: "1.5px solid",
              borderColor: t === "forest" ? "#2D6A4F" : t === "dark" ? "#30363D" : t === "blade" ? "#f59e0b" : "#A8D5BA",
            }}
          />
        ))}
      </div>
    </aside>
  );
}
