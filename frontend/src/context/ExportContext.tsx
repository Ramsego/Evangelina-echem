import { createContext, useContext, useRef } from "react";

export type ExportFmt = "png" | "svg" | "csv" | "txt";

export interface CollectResult {
  filename: string;          // base name without extension
  csv:      string;
  txt?:     string;          // LLM-ready analysis summary
  plotData: Plotly.Data[];
  layout:   Partial<Plotly.Layout>;
}

type ExportFn  = (fmt: ExportFmt) => void;
type CollectFn = () => CollectResult;

interface PanelEntry {
  exportFn:  ExportFn;
  collectFn: CollectFn;
}

interface ExportContextValue {
  register:   (id: string, exportFn: ExportFn, collectFn: CollectFn) => void;
  unregister: (id: string) => void;
  exportOne:  (id: string, fmt: ExportFmt) => void;
  exportAll:  (fmt: ExportFmt) => void;
  collectOne: (id: string) => CollectResult | undefined;
  collectAll: () => CollectResult[];
}

const ExportContext = createContext<ExportContextValue | null>(null);

export function ExportProvider({ children }: { children: React.ReactNode }) {
  const registry = useRef(new Map<string, PanelEntry>());

  const register = (id: string, exportFn: ExportFn, collectFn: CollectFn) =>
    registry.current.set(id, { exportFn, collectFn });

  const unregister = (id: string) => registry.current.delete(id);

  const exportOne = (id: string, fmt: ExportFmt) =>
    registry.current.get(id)?.exportFn(fmt);

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

  return (
    <ExportContext.Provider value={{ register, unregister, exportOne, exportAll, collectOne, collectAll }}>
      {children}
    </ExportContext.Provider>
  );
}

export function useExportContext() {
  const ctx = useContext(ExportContext);
  if (!ctx) throw new Error("useExportContext must be inside ExportProvider");
  return ctx;
}
