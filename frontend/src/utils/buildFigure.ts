import { ParsedFile } from "../types";

const COLORS = [
  "#74C69D", "#D4A057", "#60a5fa", "#f472b6",
  "#a78bfa", "#fbbf24", "#34d399", "#f87171",
];

const BASE_LAYOUT: Partial<Plotly.Layout> = {
  paper_bgcolor: "#111E16",
  plot_bgcolor:  "#0D1C14",
  font: { family: "Inter, system-ui, sans-serif", size: 11, color: "#74C69D" },
  margin: { l: 52, r: 16, t: 28, b: 48 },
  showlegend: true,
  legend: {
    bgcolor: "rgba(11,22,16,0.85)",
    bordercolor: "#1B4332",
    borderwidth: 1,
    font: { color: "#A8D5BA", size: 11 },
  },
  xaxis: {
    gridcolor: "#1B4332",
    linecolor: "#2D6A4F",
    tickfont:  { color: "#52B788" },
    title:     { font: { color: "#74C69D" } },
  },
  yaxis: {
    gridcolor: "#1B4332",
    linecolor: "#2D6A4F",
    tickfont:  { color: "#52B788" },
    title:     { font: { color: "#74C69D" } },
  },
};

export function buildFigure(file: ParsedFile): {
  data: Plotly.Data[];
  layout: Partial<Plotly.Layout>;
} {
  if (file.etype === "CV" || file.etype === "LSV") return buildCV(file);
  if (file.etype === "EISPOT")                      return buildNyquist(file);
  if (file.etype === "CHRONOP" || file.etype === "PWR800_CYCLICCHARGEDISCHARGE")
    return buildGCD(file);
  return { data: [], layout: BASE_LAYOUT };
}

function buildCV(file: ParsedFile) {
  const curves = file.curves ?? [];
  const data: Plotly.Data[] = curves.map((c, i) => ({
    x: c.vf,
    y: c.im.map((v) => v * 1000),
    type: "scatter" as const,
    mode: "lines" as const,
    name: `Cycle ${i + 1}`,
    line: { color: COLORS[i % COLORS.length], width: 1.8 },
  }));
  return {
    data,
    layout: {
      ...BASE_LAYOUT,
      xaxis: { ...BASE_LAYOUT.xaxis, title: { text: "Potential (V)",  font: { color: "#74C69D" } } },
      yaxis: { ...BASE_LAYOUT.yaxis, title: { text: "Current (mA)",   font: { color: "#74C69D" } } },
    } as Partial<Plotly.Layout>,
  };
}

function buildNyquist(file: ParsedFile) {
  const eis = file.eis;
  if (!eis) return { data: [], layout: BASE_LAYOUT };

  const negZimag = eis.zimag.map((v) => -v);
  const limit    = Math.max(...eis.zreal, ...negZimag) * 1.08;

  const data: Plotly.Data[] = [{
    x: eis.zreal,
    y: negZimag,
    type: "scatter" as const,
    mode: "lines+markers" as const,
    name: "Nyquist",
    marker: { color: COLORS[0], size: 5 },
    line:   { color: COLORS[0], width: 1.5 },
  }];

  return {
    data,
    layout: {
      ...BASE_LAYOUT,
      xaxis: {
        ...BASE_LAYOUT.xaxis,
        title:       { text: "Z′ (Ω)", font: { color: "#74C69D" } },
        range:       [0, limit],
        scaleanchor: "y",
        scaleratio:  1,
        constrain:   "domain",
      },
      yaxis: {
        ...BASE_LAYOUT.yaxis,
        title: { text: "−Z″ (Ω)", font: { color: "#74C69D" } },
        range: [0, limit],
        constrain: "domain",
      },
    } as Partial<Plotly.Layout>,
  };
}

function buildGCD(file: ParsedFile) {
  const gcd = file.gcd;
  if (!gcd) return { data: [], layout: BASE_LAYOUT };

  const disMah = gcd.discharge_caps.map((c) => (c / 3600) * 1000);
  const data: Plotly.Data[] = [{
    x: gcd.cycles,
    y: disMah,
    type: "scatter" as const,
    mode: "lines+markers" as const,
    name: "Discharge capacity",
    line:   { color: COLORS[0], width: 2 },
    marker: { color: COLORS[0], size: 4 },
  }];

  return {
    data,
    layout: {
      ...BASE_LAYOUT,
      xaxis: { ...BASE_LAYOUT.xaxis, title: { text: "Cycle",          font: { color: "#74C69D" } } },
      yaxis: { ...BASE_LAYOUT.yaxis, title: { text: "Capacity (mAh)", font: { color: "#74C69D" } } },
    } as Partial<Plotly.Layout>,
  };
}
