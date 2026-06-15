export interface StyleSettings {
  framework:          string;
  colorScheme:        string;
  customPalette?:     string[];  // per-trace override; if set, overrides colorScheme palette
  // Lines & markers
  lineWidth:          number;
  lineDash:           "solid" | "dash" | "dot" | "dashdot";
  showMarkers:        boolean;
  markerSize:         number;
  markerShape:        string;
  // Axes
  mirrorAxes:         boolean;
  showXGrid:          boolean;
  showYGrid:          boolean;
  gridColor:          string;
  gridLineStyle:      "solid" | "dash" | "dot" | "dashdot";
  gridLineWidth:      number;
  axisLineColor:      string;
  axisLineWidth:      number;
  tickDirection:      "outside" | "inside";
  plotBgColor:        string;
  showBorder:         boolean;
  // Text
  fontFamily:         string;
  fontSizeBody:       number;
  fontSizeTitle:      number;
  axisLabelFontSize:  number;
  // Legend
  showLegend:         boolean;
  legendX:            number;
  legendY:            number;
  legendOrientation:  "v" | "h";
  legendFontSizeMode: "auto" | "manual";
  legendFontSize:     number;
  legendBelow:        boolean;
  // Export
  exportShape:        "wide" | "square";  // exported figure aspect; on-screen unaffected
}

export const PALETTES: Record<string, string[]> = {
  "Forest":           ["#74C69D", "#D4A057", "#60a5fa", "#f472b6", "#a78bfa", "#fbbf24", "#34d399", "#f87171"],
  "Default":          ["#2563EB", "#DC2626", "#16A34A", "#D97706", "#7C3AED", "#0891B2", "#BE185D", "#65A30D"],
  "Electrochemistry": ["#1A56DB", "#C0392B", "#1E8449", "#E67E22", "#6C3483", "#148F77", "#2C3E50", "#E91E63"],
  "Colorblind-safe":  ["#0072B2", "#E69F00", "#56B4E9", "#009E73", "#D55E00", "#CC79A7", "#F0E442", "#000000"],
  "Grayscale":        ["#000000", "#404040", "#707070", "#A0A0A0", "#C0C0C0"],
  "Warm":             ["#C0392B", "#E67E22", "#F39C12", "#D35400", "#922B21"],
  "Cool":             ["#1565C0", "#00838F", "#2E7D32", "#4527A0", "#0277BD"],
  "Pastel":           ["#5B9BD5", "#ED7D31", "#A9D18E", "#FFC000", "#9E70B4"],
  "Blade":            ["#27d8ff", "#f59e0b", "#ff2f6d", "#c06bff", "#44ff92", "#ffd166", "#5eead4", "#fb7185"],
};

export const MARKER_SHAPES: Record<string, string> = {
  "Circle":       "circle",
  "Square":       "square",
  "Diamond":      "diamond",
  "Triangle ▲":   "triangle-up",
  "Triangle ▼":   "triangle-down",
  "Cross":        "cross",
  "X":            "x",
  "Star":         "star",
};

export const FONT_FAMILIES: Record<string, string> = {
  "Inter":           "Inter, system-ui, sans-serif",
  "Arial":           "Arial, sans-serif",
  "Helvetica":       "Helvetica Neue, Helvetica, sans-serif",
  "Times New Roman": "Times New Roman, Times, serif",
  "Courier New":     "Courier New, Courier, monospace",
};

export const FRAMEWORKS: Record<string, StyleSettings> = {
  "Forest (Dark)": {
    framework: "Forest (Dark)", colorScheme: "Forest",
    lineWidth: 2.0, lineDash: "solid", showMarkers: false, markerSize: 5, markerShape: "circle",
    mirrorAxes: true, showXGrid: true, showYGrid: true,
    gridColor: "#1B4332", gridLineStyle: "solid", gridLineWidth: 1.0,
    axisLineColor: "#2D6A4F", axisLineWidth: 1.2, tickDirection: "outside",
    plotBgColor: "#0D1C14", showBorder: false,
    fontFamily: "Inter", fontSizeBody: 11, fontSizeTitle: 13, axisLabelFontSize: 12,
    showLegend: true, legendX: 1, legendY: 1, legendOrientation: "v", legendFontSizeMode: "auto", legendFontSize: 11, legendBelow: false,
    exportShape: "wide",
  },
  "Default": {
    framework: "Default", colorScheme: "Default",
    lineWidth: 2.0, lineDash: "solid", showMarkers: true, markerSize: 6, markerShape: "circle",
    mirrorAxes: true, showXGrid: true, showYGrid: true,
    gridColor: "#E2E8F0", gridLineStyle: "solid", gridLineWidth: 1.0,
    axisLineColor: "#94A3B8", axisLineWidth: 1.0, tickDirection: "outside",
    plotBgColor: "#FFFFFF", showBorder: false,
    fontFamily: "Inter", fontSizeBody: 12, fontSizeTitle: 14, axisLabelFontSize: 13,
    showLegend: true, legendX: 1, legendY: 1, legendOrientation: "v", legendFontSizeMode: "auto", legendFontSize: 11, legendBelow: false,
    exportShape: "wide",
  },
  "Electrochemistry": {
    framework: "Electrochemistry", colorScheme: "Electrochemistry",
    lineWidth: 2.2, lineDash: "solid", showMarkers: true, markerSize: 6, markerShape: "circle",
    mirrorAxes: true, showXGrid: false, showYGrid: false,
    gridColor: "#E5E7EB", gridLineStyle: "solid", gridLineWidth: 0.5,
    axisLineColor: "#1C1C1C", axisLineWidth: 1.5, tickDirection: "inside",
    plotBgColor: "#FFFFFF", showBorder: true,
    fontFamily: "Arial", fontSizeBody: 11, fontSizeTitle: 13, axisLabelFontSize: 12,
    showLegend: true, legendX: 1, legendY: 1, legendOrientation: "v", legendFontSizeMode: "auto", legendFontSize: 11, legendBelow: false,
    exportShape: "wide",
  },
  "ACS Publication": {
    framework: "ACS Publication", colorScheme: "Default",
    lineWidth: 2.0, lineDash: "solid", showMarkers: true, markerSize: 6, markerShape: "circle",
    mirrorAxes: true, showXGrid: false, showYGrid: false,
    gridColor: "#E5E7EB", gridLineStyle: "solid", gridLineWidth: 0.5,
    axisLineColor: "#000000", axisLineWidth: 1.5, tickDirection: "inside",
    plotBgColor: "#FFFFFF", showBorder: true,
    fontFamily: "Arial", fontSizeBody: 10, fontSizeTitle: 13, axisLabelFontSize: 12,
    showLegend: true, legendX: 1, legendY: 1, legendOrientation: "v", legendFontSizeMode: "auto", legendFontSize: 10, legendBelow: false,
    exportShape: "wide",
  },
  "Nature / Science": {
    framework: "Nature / Science", colorScheme: "Colorblind-safe",
    lineWidth: 2.0, lineDash: "solid", showMarkers: true, markerSize: 5, markerShape: "circle",
    mirrorAxes: true, showXGrid: true, showYGrid: true,
    gridColor: "#EBEBEB", gridLineStyle: "solid", gridLineWidth: 0.5,
    axisLineColor: "#333333", axisLineWidth: 1.0, tickDirection: "outside",
    plotBgColor: "#FFFFFF", showBorder: true,
    fontFamily: "Helvetica", fontSizeBody: 10, fontSizeTitle: 12, axisLabelFontSize: 11,
    showLegend: true, legendX: 1, legendY: 1, legendOrientation: "v", legendFontSizeMode: "auto", legendFontSize: 10, legendBelow: false,
    exportShape: "wide",
  },
  "Presentation": {
    framework: "Presentation", colorScheme: "Default",
    lineWidth: 3.5, lineDash: "solid", showMarkers: true, markerSize: 10, markerShape: "circle",
    mirrorAxes: true, showXGrid: true, showYGrid: true,
    gridColor: "#DDDDDD", gridLineStyle: "solid", gridLineWidth: 0.5,
    axisLineColor: "#1a1a1a", axisLineWidth: 2.0, tickDirection: "outside",
    plotBgColor: "#FFFFFF", showBorder: false,
    fontFamily: "Arial", fontSizeBody: 14, fontSizeTitle: 18, axisLabelFontSize: 16,
    showLegend: true, legendX: 1, legendY: 1, legendOrientation: "v", legendFontSizeMode: "auto", legendFontSize: 13, legendBelow: false,
    exportShape: "wide",
  },
  "Minimal": {
    framework: "Minimal", colorScheme: "Colorblind-safe",
    lineWidth: 2.0, lineDash: "solid", showMarkers: false, markerSize: 5, markerShape: "circle",
    mirrorAxes: true, showXGrid: false, showYGrid: false,
    gridColor: "#F9FAFB", gridLineStyle: "solid", gridLineWidth: 0.5,
    axisLineColor: "#555555", axisLineWidth: 1.2, tickDirection: "outside",
    plotBgColor: "#FAFAFA", showBorder: false,
    fontFamily: "Helvetica", fontSizeBody: 11, fontSizeTitle: 13, axisLabelFontSize: 12,
    showLegend: true, legendX: 1, legendY: 1, legendOrientation: "v", legendFontSizeMode: "auto", legendFontSize: 11, legendBelow: false,
    exportShape: "wide",
  },
  "Blade": {
    framework: "Blade", colorScheme: "Blade",
    lineWidth: 2.0, lineDash: "solid", showMarkers: false, markerSize: 5, markerShape: "circle",
    mirrorAxes: true, showXGrid: true, showYGrid: true,
    gridColor: "#2a2040", gridLineStyle: "solid", gridLineWidth: 1.0,
    axisLineColor: "#4a3a66", axisLineWidth: 1.2, tickDirection: "outside",
    plotBgColor: "#0e0a15", showBorder: false,
    fontFamily: "Inter", fontSizeBody: 11, fontSizeTitle: 13, axisLabelFontSize: 12,
    showLegend: true, legendX: 1, legendY: 1, legendOrientation: "v", legendFontSizeMode: "auto", legendFontSize: 11, legendBelow: false,
    exportShape: "wide",
  },
};

export const DEFAULT_STYLE: StyleSettings = FRAMEWORKS["Forest (Dark)"];
