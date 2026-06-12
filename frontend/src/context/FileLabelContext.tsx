import { createContext, useContext, ReactNode } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { shortName } from "../utils/plotUtils";

interface FileLabelCtx {
  labels:    Record<string, string>;
  setLabel:  (id: string, label: string) => void;
  clearLabel: (id: string) => void;
  getLabel:  (id: string, fallback: string) => string;
}

const Ctx = createContext<FileLabelCtx>({
  labels:    {},
  setLabel:  () => {},
  clearLabel: () => {},
  getLabel:  (_, fallback) => shortName(fallback),
});

export function FileLabelProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useLocalStorage<Record<string, string>>("gamry-labels", {});

  const setLabel = (id: string, label: string) => {
    if (label.trim()) {
      setLabels({ ...labels, [id]: label.trim() });
    } else {
      clearLabel(id);
    }
  };

  const clearLabel = (id: string) => {
    const next = { ...labels };
    delete next[id];
    setLabels(next);
  };

  const getLabel = (id: string, fallback: string) => labels[id] ?? shortName(fallback);

  return <Ctx.Provider value={{ labels, setLabel, clearLabel, getLabel }}>{children}</Ctx.Provider>;
}

export const useFileLabels = () => useContext(Ctx);
