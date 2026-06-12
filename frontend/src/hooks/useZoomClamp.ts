import { useRef, useState, useCallback, useEffect } from "react";

const PAD = 0.05;

interface Extents {
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  xIsLog?: boolean;
  yIsLog?: boolean;
}

export interface AxisClamp {
  x?: [number, number];
  y?: [number, number];
}

function axisBounds(min: number, max: number, isLog?: boolean): [number, number] | null {
  if (!isLog) return [min, max];
  if (min <= 0 || max <= 0) return null;
  return [Math.log10(min), Math.log10(max)];
}

export function useZoomClamp(
  extents: Extents | null,
  zoomOnRelayout: (update: Record<string, unknown>) => void,
  uiRevKey: string,
) {
  const [clamp, setClamp] = useState<AxisClamp>({});
  const [clampVersion, setClampVersion] = useState(0);
  const clampRef = useRef<AxisClamp>({});

  // Clear the clamp whenever the base context changes (file, curves, norm, etc.)
  useEffect(() => {
    clampRef.current = {};
    setClamp({});
  }, [uiRevKey]);

  const onRelayout = useCallback((update: Record<string, unknown>) => {
    zoomOnRelayout(update);

    if (update["xaxis.autorange"] === true || update["yaxis.autorange"] === true) {
      clampRef.current = {};
      setClamp({});
      return;
    }

    if (!extents) return;

    const { xMin, xMax, yMin, yMax, xIsLog, yIsLog } = extents;
    let newX = clampRef.current.x;
    let newY = clampRef.current.y;
    let changed = false;
    // Set to true whenever a zoom-out beyond extents is detected, even if the
    // clamp value didn't change. Every detection bumps clampVersion so that
    // key={plotKey} on <Plot> remounts Plotly from scratch, giving it no saved
    // state to override our forced range with.
    let needsKeyBump = false;

    if ("xaxis.range[0]" in update) {
      const lo = Number(update["xaxis.range[0]"]);
      const hi = Number(update["xaxis.range[1]"]);
      const bounds = axisBounds(xMin, xMax, xIsLog);
      if (bounds) {
        const [min, max] = bounds;
        const span = max - min;
        const pad = span * PAD;
        // Add a tiny relative tolerance so the echo that Plotly fires after a
        // remount (range == our clamped range exactly, hi-lo == span+2*pad) does
        // not itself trigger another clamp/remount cycle.
        const next: [number, number] | undefined =
          span > 0 && hi - lo > (span + 2 * pad) * (1 + 1e-9) ? [min - pad, max + pad] : undefined;
        if (next !== undefined) {
          needsKeyBump = true;
          if (next[0] !== newX?.[0] || next[1] !== newX?.[1]) { newX = next; changed = true; }
        } else if (newX !== undefined) {
          // Keep the clamp if this looks like Plotly's echo relayout after we
          // forced the range (values match ours within floating-point tolerance).
          // Otherwise the user genuinely zoomed in or panned — clear it.
          const close = (v: number, r: number) => Math.abs(v - r) < 1e-6;
          if (!(close(lo, newX[0]) && close(hi, newX[1]))) { newX = undefined; changed = true; }
        }
      }
    }

    if ("yaxis.range[0]" in update) {
      const lo = Number(update["yaxis.range[0]"]);
      const hi = Number(update["yaxis.range[1]"]);
      const bounds = axisBounds(yMin, yMax, yIsLog);
      if (bounds) {
        const [min, max] = bounds;
        const span = max - min;
        const pad = span * PAD;
        const next: [number, number] | undefined =
          span > 0 && hi - lo > (span + 2 * pad) * (1 + 1e-9) ? [min - pad, max + pad] : undefined;
        if (next !== undefined) {
          needsKeyBump = true;
          if (next[0] !== newY?.[0] || next[1] !== newY?.[1]) { newY = next; changed = true; }
        } else if (newY !== undefined) {
          const close = (v: number, r: number) => Math.abs(v - r) < 1e-6;
          if (!(close(lo, newY[0]) && close(hi, newY[1]))) { newY = undefined; changed = true; }
        }
      }
    }

    if (changed) {
      clampRef.current = { x: newX, y: newY };
      setClamp({ x: newX, y: newY });
    }
    // Bump key on every zoom-out detection — remounting Plotly from scratch is
    // the only reliable way to force it to use our autorange:false range.
    if (needsKeyBump) {
      setClampVersion(v => v + 1);
    }
  }, [extents, zoomOnRelayout]);

  // Always include the version so uirevision is stable when a clamp is cleared
  // (clearing would otherwise change the string back to uiRevKey, which Plotly
  // would interpret as a brand-new chart and discard the user's zoom-in).
  const uirevision = `${uiRevKey}-v${clampVersion}`;

  return { onRelayout, clamp, uirevision, plotKey: clampVersion };
}
