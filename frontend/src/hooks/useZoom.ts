import { useState, useEffect, useRef, useCallback } from "react";

export interface LegendDragState {
  x?: number;
  y?: number;
}

export function useZoom(resetKey: string) {
  const [legendState, setLegendState] = useState<LegendDragState>({});
  const [hasZoom, setHasZoom]         = useState(false);
  const rangeRef = useRef<{ x?: [number, number]; y?: [number, number] }>({});

  useEffect(() => {
    setHasZoom(false);
    rangeRef.current = {};
  }, [resetKey]);

  const onRelayout = useCallback((update: Record<string, unknown>) => {
    if (update["xaxis.autorange"] === true) {
      delete rangeRef.current.x;
      setHasZoom(prev => prev && !!rangeRef.current.y);
    } else if ("xaxis.range[0]" in update) {
      rangeRef.current.x = [Number(update["xaxis.range[0]"]), Number(update["xaxis.range[1]"])];
      setHasZoom(true);
    }

    if (update["yaxis.autorange"] === true) {
      delete rangeRef.current.y;
    } else if ("yaxis.range[0]" in update) {
      rangeRef.current.y = [Number(update["yaxis.range[0]"]), Number(update["yaxis.range[1]"])];
      setHasZoom(true);
    }

    if ("legend.x" in update || "legend.y" in update) {
      setLegendState(prev => ({
        ...prev,
        ...(typeof update["legend.x"] === "number" ? { x: update["legend.x"] as number } : {}),
        ...(typeof update["legend.y"] === "number" ? { y: update["legend.y"] as number } : {}),
      }));
    }
  }, []);

  const getRangeSnapshot = useCallback(
    () => ({ ...rangeRef.current }),
    []
  );

  return { onRelayout, legendState, hasZoom, getRangeSnapshot };
}
