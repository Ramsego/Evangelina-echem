import { StyleSettings, PALETTES, FONT_FAMILIES } from "../styles/styleTypes";

export function autoLegendFontSize(size: { width: number; height: number }): number {
  if (size.width <= 0 || size.height <= 0) return 11;
  return Math.round(Math.min(14, Math.max(4, Math.min(size.width / 70, size.height / 32))));
}

export function resolveLegendFontSize(
  style: StyleSettings,
  size: { width: number; height: number },
): number {
  return style.legendFontSizeMode === "manual" ? style.legendFontSize : autoLegendFontSize(size);
}

function textColor(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#1C2B1E" : "#E2E8F0";
}


export type StyledTrace = Plotly.Data & { fixedColor?: string };

export function applyStyleToData(data: StyledTrace[], style: StyleSettings): Plotly.Data[] {
  const palette = style.customPalette ?? PALETTES[style.colorScheme] ?? PALETTES["Forest"];
  let colorIdx = 0;

  return data.map((trace) => {
    const t = { ...trace } as Record<string, unknown>;
    const mode = (t.mode as string) ?? "";
    const fixedColor = t.fixedColor as string | undefined;

    if (fixedColor) {
      if (t.line)   t.line   = { ...(t.line   as object), color: fixedColor };
      if (t.marker) t.marker = { ...(t.marker as object), color: fixedColor };
    } else {
      const color = palette[colorIdx % palette.length];
      colorIdx++;
      if (t.line)   t.line   = { ...(t.line   as object), color };
      if (t.marker) t.marker = { ...(t.marker as object), color };
    }

    // Line settings — skip pure-marker traces (peak annotations, etc.)
    if (mode !== "markers" && t.line) {
      t.line = { ...(t.line as object), width: style.lineWidth, dash: style.lineDash };
    }

    // Marker visibility and shape (skip pure-marker annotation traces)
    if (mode === "lines" && style.showMarkers) {
      t.mode   = "lines+markers";
      t.marker = { ...(t.marker as object), size: style.markerSize, symbol: style.markerShape };
    } else if (mode === "lines+markers" && !style.showMarkers) {
      t.mode = "lines";
    } else if (style.showMarkers && t.marker) {
      const isAnnotation = mode === "markers";
      t.marker = { ...(t.marker as object), size: style.markerSize, ...(isAnnotation ? {} : { symbol: style.markerShape }) };
    }

    return t as Plotly.Data;
  });
}

function styledAxis(
  base: Plotly.LayoutAxis | undefined,
  style: StyleSettings,
  fg: string
): Partial<Plotly.LayoutAxis> {
  const titleObj = (base?.title as object | string | undefined);
  const titleText = typeof titleObj === "string"
    ? titleObj
    : (titleObj as { text?: string } | undefined)?.text ?? "";

  return {
    ...(base ?? {}),
    gridcolor:   style.gridColor,
    griddash:    style.gridLineStyle,
    gridwidth:   style.gridLineWidth,
    linecolor:   style.axisLineColor,
    linewidth:   style.axisLineWidth,
    mirror:      style.mirrorAxes ? (true as const) : (false as const),
    ticks:       style.tickDirection as "outside" | "inside" | "",
    tickcolor:   style.axisLineColor,
    tickfont:    { family: FONT_FAMILIES[style.fontFamily] ?? style.fontFamily, size: style.fontSizeBody, color: fg },
    title:       { text: titleText, font: { family: FONT_FAMILIES[style.fontFamily] ?? style.fontFamily, size: style.axisLabelFontSize, color: fg } },
  };
}

export function applyStyleToLayout(
  layout: Partial<Plotly.Layout>,
  style: StyleSettings
): Partial<Plotly.Layout> {
  const fg     = textColor(style.plotBgColor);
  const fontFam = FONT_FAMILIES[style.fontFamily] ?? style.fontFamily;
  const legBg  = textColor(style.plotBgColor) === "#E2E8F0"
    ? "rgba(0,0,0,0.05)"
    : "rgba(255,255,255,0.08)";

  const result: Partial<Plotly.Layout> = {
    ...layout,
    autosize:      true,          // ensures plot fills its container on every render
    paper_bgcolor: style.plotBgColor,
    plot_bgcolor:  style.plotBgColor,
    font:          { family: fontFam, size: style.fontSizeBody, color: fg },
    showlegend:    style.showLegend,
    legend: {
      x:            style.legendX,
      y:            style.legendY,
      xanchor:      "auto" as const,
      yanchor:      "auto" as const,
      orientation:  style.legendOrientation as "v" | "h",
      bgcolor:      legBg,
      borderwidth:  0,
      font:         { family: fontFam, size: style.legendFontSize, color: fg },
      tracegroupgap: 0,
      itemwidth:    20,
    },
    xaxis: {
      ...styledAxis(layout.xaxis as Plotly.LayoutAxis, style, fg),
      showgrid: style.showXGrid,
    },
    yaxis: {
      ...styledAxis(layout.yaxis as Plotly.LayoutAxis, style, fg),
      showgrid: style.showYGrid,
    },
  };

  if (style.legendBelow) {
    result.legend = {
      ...result.legend,
      x:           0.5,
      y:           -0.12,
      xanchor:     "center" as const,
      yanchor:     "top"    as const,
      orientation: "h"      as const,
    };
    result.margin = { ...(result.margin as object ?? {}), b: 90 };
  }

  // Style secondary y-axis if present — uses second palette color to match its trace
  if (layout.yaxis2) {
    const palette  = style.customPalette ?? PALETTES[style.colorScheme] ?? PALETTES["Forest"];
    const y2Color  = palette[1] ?? fg;
    const y2Base   = layout.yaxis2 as Partial<Plotly.LayoutAxis>;
    const y2TitleObj = y2Base.title as { text?: string } | string | undefined;
    const y2Text   = typeof y2TitleObj === "string" ? y2TitleObj : (y2TitleObj as { text?: string } | undefined)?.text ?? "";
    result.yaxis2  = {
      ...y2Base,
      linecolor:  y2Color,
      linewidth:  style.axisLineWidth,
      tickcolor:  y2Color,
      tickfont:   { family: fontFam, size: style.fontSizeBody, color: y2Color },
      title:      { text: y2Text, font: { family: fontFam, size: style.axisLabelFontSize, color: y2Color } },
      gridcolor:  style.gridColor,
      griddash:   style.gridLineStyle,
      gridwidth:  style.gridLineWidth,
      mirror:     false,  // yaxis2 is its own right-side axis; no mirroring needed
    } as Partial<Plotly.LayoutAxis>;
  }

  return result;
}
