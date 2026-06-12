import { createContext, useContext, useState, useMemo, useCallback, ReactNode } from "react";
import { StyleSettings, DEFAULT_STYLE } from "../styles/styleTypes";

interface StyleCtx {
  globalStyle: StyleSettings;
  panelStyles: Record<string, StyleSettings>;
  selectedId:  string | null;
  setSelected: (id: string | null) => void;
  setGlobal:   (s: StyleSettings) => void;
  setPanel:    (id: string, s: StyleSettings) => void;
  clearPanel:  (id: string) => void;
  getStyleFor: (id: string) => StyleSettings;
  legendAutoSizes: Record<string, number>;
  setLegendAutoSize: (id: string, size: number) => void;
}

const StyleContext = createContext<StyleCtx | null>(null);

export function StyleProvider({
  globalStyle,
  setGlobal,
  children,
}: {
  globalStyle: StyleSettings;
  setGlobal:   (s: StyleSettings) => void;
  children:    ReactNode;
}) {
  const [panelStyles, setPanelStyles] = useState<Record<string, StyleSettings>>({});
  const [selectedId,  setSelected]    = useState<string | null>(null);
  const [legendAutoSizes, setLegendAutoSizes] = useState<Record<string, number>>({});

  const setPanel = useCallback((id: string, s: StyleSettings) =>
    setPanelStyles(prev => ({ ...prev, [id]: s })), []);

  const clearPanel = useCallback((id: string) =>
    setPanelStyles(prev => { const next = { ...prev }; delete next[id]; return next; }), []);

  const getStyleFor = useCallback((id: string): StyleSettings =>
    panelStyles[id] ? { ...globalStyle, ...panelStyles[id] } : globalStyle, [panelStyles, globalStyle]);

  const setLegendAutoSize = useCallback((id: string, size: number) =>
    setLegendAutoSizes(prev => prev[id] === size ? prev : { ...prev, [id]: size }), []);

  const value = useMemo(() => ({
    globalStyle, panelStyles, selectedId,
    setSelected, setGlobal, setPanel, clearPanel, getStyleFor,
    legendAutoSizes, setLegendAutoSize,
  }), [globalStyle, panelStyles, selectedId, setGlobal, setPanel, clearPanel, getStyleFor, legendAutoSizes, setLegendAutoSize]);

  return (
    <StyleContext.Provider value={value}>
      {children}
    </StyleContext.Provider>
  );
}

export function useStyleContext() {
  const ctx = useContext(StyleContext);
  if (!ctx) throw new Error("useStyleContext must be inside StyleProvider");
  return ctx;
}

export function useStyle(panelId?: string): StyleSettings {
  const ctx = useContext(StyleContext);
  if (!ctx) return DEFAULT_STYLE;
  return panelId ? ctx.getStyleFor(panelId) : ctx.globalStyle;
}
