import { createContext, useContext, useRef } from "react";
import type { PanelSummary } from "../utils/exportUtils";

export type ExportFmt = "png" | "svg" | "csv";

export interface CollectResult {
  filename: string;          // base name without extension
  csv:      string;
  summary?: PanelSummary;    // LLM-ready analysis summary
  plotData: Plotly.Data[];
  layout:   Partial<Plotly.Layout>;
}

/** A pre-built table = the exact plotted columns, handed to the backend verbatim. */
export interface ExportSheet {
  name:    string;
  headers: string[];
  units?:  string[];
  rows:    (string | number | null)[][];
}

type ExportFn  = (fmt: ExportFmt, filename?: string) => void;
type CollectFn = () => CollectResult;
type SheetsFn  = () => ExportSheet[];

interface PanelEntry {
  exportFn:   ExportFn;
  collectFn:  CollectFn;
  buildSheets?: SheetsFn;
}

interface ExportContextValue {
  register:   (id: string, exportFn: ExportFn, collectFn: CollectFn, buildSheets?: SheetsFn) => void;
  unregister: (id: string) => void;
  exportOne:  (id: string, fmt: ExportFmt, filename?: string) => void;
  exportAll:  (fmt: ExportFmt) => void;
  collectOne: (id: string) => CollectResult | undefined;
  collectAll: () => CollectResult[];
  collectSheets: (id: string) => ExportSheet[] | undefined;
}

const ExportContext = createContext<ExportContextValue | null>(null);

export function ExportProvider({ children }: { children: React.ReactNode }) {
  const registry = useRef(new Map<string, PanelEntry>());

  const register = (id: string, exportFn: ExportFn, collectFn: CollectFn, buildSheets?: SheetsFn) =>
    registry.current.set(id, { exportFn, collectFn, buildSheets });

  const unregister = (id: string) => registry.current.delete(id);

  const exportOne = (id: string, fmt: ExportFmt, filename?: string) =>
    registry.current.get(id)?.exportFn(fmt, filename);

  const exportAll = (fmt: ExportFmt) => {
    let delay = 0;
    registry.current.forEach(({ exportFn }) => {
      setTimeout(() => exportFn(fmt), delay);
      delay += 500;
    });
  };

  const collectOne = (id: string): CollectResult | undefined =>
    registry.current.get(id)?.collectFn();

  const collectAll = (): CollectResult[] =>
    Array.from(registry.current.values()).map(({ collectFn }) => collectFn());

  const collectSheets = (id: string): ExportSheet[] | undefined =>
    registry.current.get(id)?.buildSheets?.();

  return (
    <ExportContext.Provider value={{ register, unregister, exportOne, exportAll, collectOne, collectAll, collectSheets }}>
      {children}
    </ExportContext.Provider>
  );
}

export function useExportContext() {
  const ctx = useContext(ExportContext);
  if (!ctx) throw new Error("useExportContext must be inside ExportProvider");
  return ctx;
}
