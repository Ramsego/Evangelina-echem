import { useMemo } from "react";
import Plot from "react-plotly.js";
import { useZoom } from "../hooks/useZoom";
import { useZoomClamp } from "../hooks/useZoomClamp";
import { useContainerSize } from "../hooks/useContainerSize";
import { computeExtents } from "../utils/plotUtils";
import { resolveLegendFontSize } from "../utils/applyStyle";
import type { StyleSettings } from "../styles/styleTypes";

interface Props {
  data: Plotly.Data[];
  layout: Partial<Plotly.Layout>;
  config?: Partial<Plotly.Config>;
  style?: React.CSSProperties;
  useResizeHandler?: boolean;
  resetKey: string;
  legendStyle?: StyleSettings;
}

function isLogAxis(axis: unknown): boolean {
  return typeof axis === "object" && axis !== null && (axis as Plotly.LayoutAxis).type === "log";
}

export default function ClampedPlot({
  data,
  layout,
  config,
  style,
  useResizeHandler,
  resetKey,
  legendStyle,
}: Props) {
  const [plotRef, plotSize] = useContainerSize();
  const { onRelayout: zoomOnRelayout, legendState } = useZoom(resetKey);
  const extents = useMemo(() => {
    const e = computeExtents(data);
    return e ? {
      ...e,
      xIsLog: isLogAxis(layout.xaxis),
      yIsLog: isLogAxis(layout.yaxis),
    } : null;
  }, [data, layout.xaxis, layout.yaxis]);
  const { onRelayout, clamp, uirevision, plotKey } = useZoomClamp(extents, zoomOnRelayout, resetKey);
  const legendFontSize = legendStyle ? resolveLegendFontSize(legendStyle, plotSize) : undefined;

  const clampedLayout = useMemo((): Partial<Plotly.Layout> => ({
    ...layout,
    uirevision,
    legend: {
      ...(layout.legend as object ?? {}),
      ...(legendFontSize ? { font: { ...(((layout.legend as { font?: object } | undefined)?.font) ?? {}), size: legendFontSize } } : {}),
      ...(legendState.x != null ? { x: legendState.x, y: legendState.y } : {}),
    },
    ...(clamp.x && { xaxis: { ...(layout.xaxis ?? {}), autorange: false as const, range: clamp.x } }),
    ...(clamp.y && { yaxis: { ...(layout.yaxis ?? {}), autorange: false as const, range: clamp.y } }),
  }), [layout, uirevision, legendFontSize, legendState, clamp]);

  return (
    <div ref={plotRef} className="relative" style={style}>
      <Plot
        key={plotKey}
        data={data}
        layout={clampedLayout}
        onRelayout={onRelayout as never}
        config={{ ...config, scrollZoom: true }}
        style={{ width: "100%", height: "100%" }}
        useResizeHandler={useResizeHandler}
      />
    </div>
  );
}
