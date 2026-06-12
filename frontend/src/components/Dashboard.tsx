import { useEffect, useLayoutEffect, useRef, useState } from "react";
import GridLayout, { Layout } from "react-grid-layout";
import { Plus } from "lucide-react";
import { ParsedFile, ComparisonSession, AnalysisSession } from "../types";
import { useFileLabels } from "../context/FileLabelContext";
import PlotPanel from "./PlotPanel";
import ComparisonPanel from "./ComparisonPanel";
import AnalysisPanel from "./AnalysisPanel";

const COLS = 12;
const MRG: [number, number] = [12, 12];
const PAD: [number, number] = [12, 12];
const ROW_UNIT = 8; // px per grid row unit
const MAX_PANEL_PX = 600; // cap for square-panel sizing; ~1:1 on typical 1440px monitors
const LS_KEY = "gamry-grid-layout";

function panelCols(total: number): number {
  if (total <= 2) return 6;   // 1-2 panels: half-width each
  if (total <= 3) return 4;   // 3 panels: one row of 3
  if (total === 4) return 6;  // 2x2
  return 4;                   // 5+: 3-column grid
}

// Returns the target pixel height for one panel, matching its pixel width for a square layout.
function calcPanelPx(containerW: number, total: number): number {
  const w = panelCols(total);
  const colWidth = Math.max(1, (containerW - 2 * PAD[0] - (COLS - 1) * MRG[0]) / COLS);
  const panelWidthPx = Math.round(w * colWidth + (w - 1) * MRG[0]);
  return Math.max(280, Math.min(MAX_PANEL_PX, panelWidthPx));
}

// Returns h in grid units for a non-collapsed panel.
function calcNormalH(containerW: number, total: number): number {
  const px = calcPanelPx(containerW, total);
  return Math.round((px + MRG[1]) / (ROW_UNIT + MRG[1]));
}

const ANALYSABLE_ETYPES = new Set(["CV", "LSV", "EISPOT", "CHRONOP", "PWR800_CYCLICCHARGEDISCHARGE"]);

// Grid order: each analysis panel sits directly after its source file's plot,
// so a freshly spawned analysis lands next to the plot it analyses.
function orderPanelIds(files: ParsedFile[], comparisons: ComparisonSession[], analyses: AnalysisSession[]): string[] {
  const byFile = new Map<string, string[]>();
  for (const a of analyses) byFile.set(a.fileId, [...(byFile.get(a.fileId) ?? []), a.id]);
  return [
    ...files.flatMap(f => [f.id, ...(byFile.get(f.id) ?? [])]),
    ...comparisons.map(c => c.id),
    ...analyses.filter(a => !files.some(f => f.id === a.fileId)).map(a => a.id),
  ];
}

const MIN_W = 3;
const MIN_H = Math.round((220 + MRG[1]) / (ROW_UNIT + MRG[1])); // 12 units ≈ 228px

function makeItem(id: string, idx: number, total: number, normalH: number): Layout {
  const w = panelCols(total);
  const perRow = COLS / w;
  const x = total === 1
    ? (COLS - w) / 2           // centre a lone panel (x=3 for w=6)
    : (idx % perRow) * w;
  return {
    i: id,
    x,
    y: Math.floor(idx / perRow) * normalH,
    w,
    h: normalH,
    minW: MIN_W,
    minH: MIN_H,
  };
}

function PanelTab({ name, onExpand }: { name: string; onExpand: () => void }) {
  return (
    <button
      onClick={onExpand}
      title={`Expand "${name}"`}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-forest-700 hover:bg-forest-600 border border-forest-600 text-forest-200 text-[11px] transition-colors max-w-[180px] shrink-0 cursor-pointer"
    >
      <span className="truncate">{name}</span>
      <Plus size={10} className="shrink-0 text-forest-400" />
    </button>
  );
}

function FileTab({ file, onExpand }: { file: ParsedFile; onExpand: () => void }) {
  const { getLabel } = useFileLabels();
  return <PanelTab name={getLabel(file.id, file.name)} onExpand={onExpand} />;
}

interface Props {
  files:                ParsedFile[];
  comparisons:          ComparisonSession[];
  analyses:             AnalysisSession[];
  onFileRemoved:        (id: string) => void;
  onComparisonRemoved:  (id: string) => void;
  onAnalysisRemoved:    (id: string) => void;
  onComparisonRenamed:  (id: string, patch: Partial<ComparisonSession>) => void;
  onAnalysisRenamed:    (id: string, patch: Partial<AnalysisSession>) => void;
  onAnalysisAdded:      (a: AnalysisSession) => void;
}

export default function Dashboard({
  files, comparisons, analyses,
  onFileRemoved, onComparisonRemoved, onAnalysisRemoved,
  onComparisonRenamed, onAnalysisRenamed, onAnalysisAdded,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { getLabel } = useFileLabels();
  const [cw, setCw] = useState(() => Math.max(window.innerWidth - 260, 400));
  const [ch, setCh] = useState(() => window.innerHeight);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [focusedCVId, setFocusedCVId]   = useState<string | null>(null);
  const [bgFileIds,   setBgFileIds]      = useState<Record<string, string | null>>({});
  const [capSettings, setCapSettings]    = useState<Record<string, { vLo: string; vHi: string; key: number }>>({});

  const toggleCollapse = (id: string) =>
    setCollapsedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const allIds    = orderPanelIds(files, comparisons, analyses);

  // Auto-collapse panels beyond the first 6 whenever the panel set grows.
  const allIdsStr = allIds.join(",");
  useEffect(() => {
    setCollapsedIds(prev => {
      const visible = allIds.filter(id => !prev.has(id));
      if (visible.length <= 6) return prev;
      const next = new Set(prev);
      visible.slice(6).forEach(id => next.add(id));
      return next;
    });
  }, [allIdsStr]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeIds = allIds.filter(id => !collapsedIds.has(id));
  const total     = activeIds.length;
  const allIdsKey = activeIds.join(",");

  // Initialize layout immediately so the first render is already correct.
  // Restore saved positions/sizes from localStorage when available.
  // Clamp saved h values so stale large sizes from before the cap was introduced don't persist.
  const MAX_H = Math.round((MAX_PANEL_PX + MRG[1]) / (ROW_UNIT + MRG[1])); // 31 units ≈ 612px
  const [layout, setLayout] = useState<Layout[]>(() => {
    const saved = localStorage.getItem(LS_KEY);
    const savedMap: Map<string, Layout> = saved
      ? new Map((JSON.parse(saved) as Layout[]).map(l => [l.i, l]))
      : new Map();
    const normalH = calcNormalH(Math.max(window.innerWidth - 260, 400), allIds.length);
    // Only restore saved x/y/w if ALL panels have saved positions — a partial
    // save means the panel count changed and the old positions may collide.
    const allSaved = allIds.every(id => savedMap.has(id));
    if (!allSaved) localStorage.removeItem(LS_KEY);
    return allIds.map((id, i) => {
      const base = makeItem(id, i, allIds.length, normalH);
      const s = savedMap.get(id);
      if (!s) return base;
      if (!allSaved) return { ...base, h: Math.min(s.h, MAX_H) };
      return { ...s, h: Math.min(s.h, MAX_H) };
    });
  });

  // Track both width and height so panels always fill the container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafId: number;
    const ro = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const { width, height } = entry.contentRect;
        if (width  > 0) setCw(Math.floor(width));
        if (height > 0) setCh(Math.floor(height));
      });
    });
    ro.observe(el);
    setCw(el.offsetWidth);
    setCh(el.offsetHeight);
    return () => { cancelAnimationFrame(rafId); ro.disconnect(); };
  }, []);

  // Rebuild positions and sizes whenever the active panel set changes (add, remove, collapse, expand).
  // Uses allIdsKey (joined string) so the effect re-fires even when total stays the same
  // but the panel identities change — avoids stale layout when one panel replaces another.
  // useLayoutEffect fires before the browser paints — no visible flash.
  // Existing panels keep their user-set x/y/w/h; only new panels get auto-positioned.
  useLayoutEffect(() => {
    setLayout(prev => {
      const prevMap = new Map(prev.map(item => [item.i, item]));
      const saved = localStorage.getItem(LS_KEY);
      const savedMap: Map<string, Layout> = saved
        ? new Map((JSON.parse(saved) as Layout[]).map(l => [l.i, l]))
        : new Map();
      const normalH = calcNormalH(cw, total);
      // When new panels are added, reset all x/y/w to avoid collisions with stale saved positions.
      // Preserve h so manually-resized panels keep their height.
      const hasNewPanels = !activeIds.every(id => savedMap.has(id));
      if (hasNewPanels) localStorage.removeItem(LS_KEY);
      return activeIds.map((id, i) => {
        const base = makeItem(id, i, activeIds.length, normalH);
        const s = savedMap.get(id) ?? prevMap.get(id);
        if (!s) return base;
        // Only trust a height that came from a user save — prev state may hold
        // an h=1 item that react-grid-layout synthesized for a just-added child
        // before this effect assigned it a real height.
        if (hasNewPanels) return savedMap.has(id) ? { ...base, h: Math.min(s.h, MAX_H) } : base;
        return { ...base, x: s.x, y: s.y, w: s.w, h: Math.min(s.h, MAX_H) };
      });
    });
  }, [allIdsKey, cw]); // eslint-disable-line react-hooks/exhaustive-deps -- activeIds/total captured via closure from current render

  if (total === 0 && collapsedIds.size === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-forest-600">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
          <path d="M3 3v18h18" /><path d="M7 16l4-4 4 4 4-8" />
        </svg>
        <p className="text-sm">Upload files or load sample data to get started</p>
      </div>
    );
  }

  const focusedFile = focusedCVId ? files.find(f => f.id === focusedCVId && f.etype === "CV") : null;
  const bgCandidates = focusedFile
    ? files.filter(f => f.id !== focusedFile.id && (f.etype === "CV" || f.etype === "LSV") && f.curves?.length)
    : [];
  const activeBg  = focusedCVId ? (bgFileIds[focusedCVId] ?? null) : null;
  const activeCap = focusedCVId ? (capSettings[focusedCVId] ?? { vLo: "", vHi: "", key: 0 }) : null;

  return (
    <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">
      {focusedFile && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-forest-850 border-b border-forest-700 text-xs shrink-0 flex-wrap">
          <span className="text-[10px] text-forest-400 shrink-0 font-medium">
            {focusedFile.name.replace(/\.dta$/i, "").slice(-30)}
          </span>
          <span className="text-forest-700 shrink-0">│</span>
          <span className="text-[10px] text-forest-400 shrink-0">BG</span>
          <select
            value={activeBg ?? ""}
            onChange={e => setBgFileIds(prev => ({ ...prev, [focusedCVId!]: e.target.value || null }))}
            className="bg-forest-800 border border-forest-700 rounded px-1 py-0.5 text-[10px] text-forest-300 max-w-[130px]"
          >
            <option value="">None</option>
            {bgCandidates.map(f => (
              <option key={f.id} value={f.id}>{f.name.replace(/\.dta$/i, "").slice(-20)}</option>
            ))}
          </select>
          {activeBg && <span className="text-[9px] text-amber-500 font-medium shrink-0">−BG</span>}
          <span className="text-forest-700 shrink-0">│</span>
          <span className="text-[10px] text-forest-400 shrink-0">Cap. V</span>
          <input
            type="number" placeholder="min" value={activeCap!.vLo}
            onChange={e => setCapSettings(prev => ({
              ...prev,
              [focusedCVId!]: { ...(prev[focusedCVId!] ?? { vLo: "", vHi: "", key: 0 }), vLo: e.target.value },
            }))}
            className="w-14 bg-forest-800 border border-forest-700 rounded px-1 py-0.5 text-[10px] text-forest-300"
          />
          <span className="text-forest-600 shrink-0">–</span>
          <input
            type="number" placeholder="max" value={activeCap!.vHi}
            onChange={e => setCapSettings(prev => ({
              ...prev,
              [focusedCVId!]: { ...(prev[focusedCVId!] ?? { vLo: "", vHi: "", key: 0 }), vHi: e.target.value },
            }))}
            className="w-14 bg-forest-800 border border-forest-700 rounded px-1 py-0.5 text-[10px] text-forest-300"
          />
          <button
            onClick={() => setCapSettings(prev => ({
              ...prev,
              [focusedCVId!]: { ...(prev[focusedCVId!] ?? { vLo: "", vHi: "" }), key: (prev[focusedCVId!]?.key ?? 0) + 1 },
            }))}
            className="px-2 py-0.5 rounded border border-forest-600 bg-forest-700 text-forest-300 text-[10px] hover:bg-forest-600 transition-colors shrink-0"
          >
            Calculate
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {total > 0 && (
          <GridLayout
            width={cw}
            cols={COLS}
            rowHeight={ROW_UNIT}
            layout={layout}
            draggableHandle=".drag-handle"
            onLayoutChange={setLayout}
            onDragStop={(l) => localStorage.setItem(LS_KEY, JSON.stringify(l))}
            onResizeStop={(l) => localStorage.setItem(LS_KEY, JSON.stringify(l))}
            margin={MRG}
            containerPadding={PAD}
            resizeHandles={['se']}
          >
            {files.filter(f => !collapsedIds.has(f.id)).map((file) => (
              <div key={file.id} style={{ height: "100%" }}>
                <PlotPanel
                  file={file}
                  allFiles={files}
                  onRemove={() => onFileRemoved(file.id)}
                  isCollapsed={false}
                  onToggleCollapse={() => toggleCollapse(file.id)}
                  bgFileId={bgFileIds[file.id] ?? null}
                  capVLo={capSettings[file.id]?.vLo ?? ""}
                  capVHi={capSettings[file.id]?.vHi ?? ""}
                  capKey={capSettings[file.id]?.key ?? 0}
                  onFocus={() => setFocusedCVId(file.id)}
                  onAnalyse={file.etype && ANALYSABLE_ETYPES.has(file.etype)
                    ? () => onAnalysisAdded({
                        id:     `ana-${file.id}`,
                        name:   `${getLabel(file.id, file.name)} Analysis`,
                        fileId: file.id,
                      })
                    : undefined}
                />
              </div>
            ))}
            {comparisons.filter(c => !collapsedIds.has(c.id)).map((c) => (
              <div key={c.id} style={{ height: "100%" }}>
                <ComparisonPanel
                  comparison={c}
                  files={files}
                  onRemove={() => onComparisonRemoved(c.id)}
                  isCollapsed={false}
                  onToggleCollapse={() => toggleCollapse(c.id)}
                  onRename={(patch) => onComparisonRenamed(c.id, patch)}
                />
              </div>
            ))}
            {analyses.filter(a => !collapsedIds.has(a.id)).map((a) => (
              <div key={a.id} style={{ height: "100%" }}>
                <AnalysisPanel
                  session={a}
                  files={files}
                  onRemove={() => onAnalysisRemoved(a.id)}
                  isCollapsed={false}
                  onToggleCollapse={() => toggleCollapse(a.id)}
                  onRename={(patch) => onAnalysisRenamed(a.id, patch)}
                />
              </div>
            ))}
          </GridLayout>
        )}
      </div>

      {collapsedIds.size > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-2 bg-forest-850 border-t border-forest-700 flex-wrap shrink-0">
          {files.filter(f => collapsedIds.has(f.id)).map(f => (
            <FileTab key={f.id} file={f} onExpand={() => toggleCollapse(f.id)} />
          ))}
          {comparisons.filter(c => collapsedIds.has(c.id)).map(c => (
            <PanelTab key={c.id} name={c.name} onExpand={() => toggleCollapse(c.id)} />
          ))}
          {analyses.filter(a => collapsedIds.has(a.id)).map(a => (
            <PanelTab key={a.id} name={a.name} onExpand={() => toggleCollapse(a.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
