import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Plot from "react-plotly.js";
import { useQuery } from "@tanstack/react-query";
import { analyzeEIS } from "../../api/client";
import { ParsedFile } from "../../types";
import InfoModal, { Calc, Formula } from "../InfoModal";
import Tooltip from "../Tooltip";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useZoom } from "../../hooks/useZoom";
import { useStyle, useStyleContext } from "../../context/StyleContext";
import { applyStyleToData, applyStyleToLayout, resolveLegendFontSize } from "../../utils/applyStyle";
import { useExportContext, CollectResult } from "../../context/ExportContext";
import { exportPlotImage, downloadCsv, downloadTxt, buildSummaryTxt, metaComments, SummarySection } from "../../utils/exportUtils";
import { useContainerSize } from "../../hooks/useContainerSize";
import { computeExtents, axisOverride, LAYOUT_BASE as SHARED_LAYOUT_BASE } from "../../utils/plotUtils";
import { useZoomClamp } from "../../hooks/useZoomClamp";
import AxisInput from "../AxisInput";
import { AlertTriangle } from "lucide-react";

const COLORS = ["#74C69D","#D4A057","#60a5fa","#f472b6","#a78bfa","#fbbf24","#34d399","#f87171"];

// EIS legends keep a visible border to separate them from dense Nyquist markers
const LAYOUT_BASE: Partial<Plotly.Layout> = {
  ...SHARED_LAYOUT_BASE,
  legend: { bgcolor: "rgba(11,22,16,0.85)", bordercolor: "#1B4332", borderwidth: 1, font: { color: "#A8D5BA", size: 11 } },
};

type View = "nyquist" | "bode" | "complex_cap";

const MODEL_LABEL: Record<string, string> = {
  randles:             "Randles",
  randles_cpe:         "Randles-CPE",
  randles_cpe_warburg: "Randles-CPE-Warburg",
};

function fmtPm(v: number | null, e: number | null, digits = 3): string {
  if (v == null) return "—";
  return `${Number(v.toPrecision(digits))}${e != null ? ` ± ${Number(e.toPrecision(2))}` : " ± —"}`;
}

interface Props { file: ParsedFile }

export default function EISPanel({ file }: Props) {
  const [view,     setView]     = useLocalStorage<View>(`${file.id}.eisView`, "nyquist");
  const [showInfo, setShowInfo] = useState(false);
  const [axesOpen,       setAxesOpen]       = useState(false);
  const [dragmode,       setDragmode]       = useState<'zoom'|'pan'>('zoom');
  const [xMin,           setXMin]           = useState("");
  const [xMax,           setXMax]           = useState("");
  const [yMin,           setYMin]           = useState("");
  const [yMax,           setYMax]           = useState("");
  // xLog/yLog initialized from view defaults; useEffect syncs on view change
  const [xLog,           setXLog]           = useState(false);
  const [yLog,           setYLog]           = useState(false);
  const [xTitleOverride, setXTitleOverride] = useState("");
  const [yTitleOverride, setYTitleOverride] = useState("");
  const style = useStyle(file.id);

  useEffect(() => {
    setXMin(""); setXMax(""); setYMin(""); setYMax("");
    setXLog(view === "bode" || view === "complex_cap");
    setYLog(view === "bode");
    setXTitleOverride(""); setYTitleOverride("");
  }, [view]);

  const [fitModel, setFitModel] = useLocalStorage<string>(`${file.id}.eisFitModel`, "auto");

  const eisQ = useQuery({
    queryKey: ["eis", file.id, fitModel],
    queryFn:  () => analyzeEIS({ eis: file.eis!, model: fitModel }), // file.eis is defined when enabled
    enabled:  !!file.eis,
  });

  // Hooks must be declared before any early return (Rules of Hooks)
  const { register, unregister } = useExportContext();
  const handleExportRef = useRef<(fmt: string) => void>(() => {});
  const collectRef = useRef<() => CollectResult>(() => ({ filename: '', csv: '', plotData: [], layout: {} }));
  const uiRevKey = `${file.id}-${view}`;
  const { onRelayout: zoomOnRelayout, legendState, hasZoom, getRangeSnapshot } = useZoom(uiRevKey);
  const [plotRef, plotSize] = useContainerSize();
  const { setLegendAutoSize } = useStyleContext();
  useEffect(() => {
    register(file.id, fmt => handleExportRef.current(fmt), () => collectRef.current());
    return () => unregister(file.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- register/unregister are stable (backed by useRef in ExportProvider); mount-only registration is intentional

  const eis = file.eis;
  const metrics = eisQ.data;

  // Loss tangent tan δ = C″/C′ at the lowest measured frequency (near-DC
  // dissipation factor). At high frequency C′ → 0 and tan δ diverges in the
  // resistive limit, so a spectrum-wide maximum is not meaningful.
  const tanDelta = useMemo(() => {
    const cc = metrics?.complex_cap;
    if (!cc) return null;
    let best: { val: number; freq: number } | null = null;
    let excluded = 0;
    for (let i = 0; i < cc.freq.length; i++) {
      const cp = cc.c_prime[i], cd = cc.c_dbl[i];
      if (!Number.isFinite(cp) || !Number.isFinite(cd) || cp <= 0) { excluded++; continue; }
      if (best == null || cc.freq[i] < best.freq) best = { val: cd / cp, freq: cc.freq[i] };
    }
    return { best, excluded };
  }, [metrics]);

  const { plotData, rawLayout } = useMemo((): { plotData: Plotly.Data[]; rawLayout: Partial<Plotly.Layout> } => {
    if (!eis) return { plotData: [], rawLayout: { ...LAYOUT_BASE } };
    const data: Plotly.Data[] = [];
    let layout: Partial<Plotly.Layout> = { ...LAYOUT_BASE };

    if (view === "nyquist") {
      const negZ = eis.zimag.map(v => -v);
      const limit = Math.max(...eis.zreal, ...negZ) * 1.08;
      data.push({
        x: eis.zreal, y: negZ,
        type: "scatter", mode: "lines+markers",
        name: "Nyquist",
        marker: { color: COLORS[0], size: 5 },
        line:   { color: COLORS[0], width: 1.5 },
      });
      if (metrics?.circuit_fit) {
        data.push({
          x: metrics.circuit_fit.fit_zreal,
          y: metrics.circuit_fit.fit_zimag.map((v: number) => -v),
          type: "scatter", mode: "lines",
          name: `Fit (${MODEL_LABEL[metrics.circuit_fit.model] ?? metrics.circuit_fit.model})`,
          line: { color: COLORS[2], width: 1.5, dash: "dash" },
        });
      }
      layout = {
        ...LAYOUT_BASE,
        xaxis: {
          ...LAYOUT_BASE.xaxis,
          title: { text: xTitleOverride || "Z′ (Ω)", font: { color: "#74C69D" } },
          range: [0, limit],
          // Always equal-scaled so impedance arcs are never distorted, even
          // when a manual axis range is set.
          scaleanchor: "y" as const, scaleratio: 1,
          ...axisOverride(xMin, xMax, xLog),
        },
        yaxis: {
          ...LAYOUT_BASE.yaxis,
          title: { text: yTitleOverride || "−Z″ (Ω)", font: { color: "#74C69D" } },
          range: [0, limit],
          ...axisOverride(yMin, yMax, yLog),
        },
      };
    } else if (view === "bode") {
      data.push({
        x: eis.freq, y: eis.zmod,
        type: "scatter", mode: "lines+markers",
        name: "|Z| (Ω)",
        marker: { color: COLORS[0], size: 5 },
        line:   { color: COLORS[0], width: 1.5 },
        yaxis: "y",
      });
      data.push({
        x: eis.freq, y: eis.zphz,
        type: "scatter", mode: "lines+markers",
        name: "Phase (°)",
        marker: { color: COLORS[1], size: 5 },
        line:   { color: COLORS[1], width: 1.5 },
        yaxis: "y2",
      });
      layout = {
        ...LAYOUT_BASE,
        margin: { ...LAYOUT_BASE.margin, r: 56 },
        xaxis: {
          ...LAYOUT_BASE.xaxis,
          title: { text: xTitleOverride || "Frequency (Hz)", font: { color: "#74C69D" } },
          ...axisOverride(xMin, xMax, xLog),
        },
        yaxis: {
          ...LAYOUT_BASE.yaxis,
          title: { text: yTitleOverride || "|Z| (Ω)", font: { color: "#74C69D" } },
          ...axisOverride(yMin, yMax, yLog),
        },
        yaxis2: {
          title:      { text: "Phase (°)", font: { color: "#D4A057" } },
          overlaying: "y", side: "right",
          gridcolor:  "#1B4332", linecolor: "#2D6A4F",
          tickfont:   { color: "#D4A057" },
        },
      };
    } else if (view === "complex_cap" && metrics?.complex_cap) {
      const cc = metrics.complex_cap;
      data.push({
        x: cc.freq, y: cc.c_prime,
        type: "scatter", mode: "lines+markers",
        name: "C′ (mF)",
        marker: { color: COLORS[0], size: 5 },
        line:   { color: COLORS[0], width: 1.5 },
      });
      data.push({
        x: cc.freq, y: cc.c_dbl,
        type: "scatter", mode: "lines+markers",
        name: "C″ (mF)",
        marker: { color: COLORS[1], size: 5 },
        line:   { color: COLORS[1], width: 1.5 },
      });
      layout = {
        ...LAYOUT_BASE,
        xaxis: {
          ...LAYOUT_BASE.xaxis,
          title: { text: xTitleOverride || "Frequency (Hz)", font: { color: "#74C69D" } },
          ...axisOverride(xMin, xMax, xLog),
        },
        yaxis: {
          ...LAYOUT_BASE.yaxis,
          title: { text: yTitleOverride || "Capacitance (mF)", font: { color: "#74C69D" } },
          ...axisOverride(yMin, yMax, yLog),
        },
      };
    }
    return { plotData: data, rawLayout: layout };
  }, [eis, view, xMin, xMax, yMin, yMax, xLog, yLog, xTitleOverride, yTitleOverride, metrics]);

  const styledPlotData = useMemo(() => applyStyleToData(plotData, style),    [plotData, style]);
  const extents = useMemo(() => { const e = computeExtents(styledPlotData); return e ? { ...e, xIsLog: xLog, yIsLog: yLog } : null; }, [styledPlotData, xLog, yLog]);
  const { onRelayout, clamp, uirevision, plotKey } = useZoomClamp(extents, zoomOnRelayout, uiRevKey);
  const styledLayout   = useMemo(() => applyStyleToLayout(rawLayout, style), [rawLayout, style]);
  const legendFontSize = resolveLegendFontSize(style, plotSize);
  useEffect(() => { setLegendAutoSize(file.id, legendFontSize); }, [file.id, legendFontSize, setLegendAutoSize]);
  const finalLayout    = useMemo((): Partial<Plotly.Layout> => ({
    ...styledLayout,
    uirevision,
    dragmode,
    legend: {
      ...(styledLayout.legend as object ?? {}),
      font: { ...(((styledLayout.legend as { font?: object } | undefined)?.font) ?? {}), size: legendFontSize },
      ...(legendState.x != null ? { x: legendState.x, y: legendState.y } : {}),
    },
    ...(clamp.x && { xaxis: { ...(styledLayout.xaxis ?? {}), autorange: false as const, range: clamp.x } }),
    ...(clamp.y && { yaxis: { ...(styledLayout.yaxis ?? {}), autorange: false as const, range: clamp.y } }),
  }), [styledLayout, uirevision, dragmode, legendFontSize, legendState, clamp]);

  if (!eis) return (
    <div className="flex-1 flex items-center justify-center text-forest-600 text-sm">No EIS data</div>
  );

  // ── Export (non-hook parts — hooks are declared before the early return) ─
  const buildCsv = useCallback((): string => {
    const meta: string[] = [
      ...metaComments(file.metadata),
      ...(metrics ? [
        `# ESR: ${metrics.esr.toFixed(2)} Ohm`,
        ...(metrics.tau_ms != null ? [`# tau0: ${metrics.tau_ms.toFixed(1)} ms`] : []),
        `# C_max: ${metrics.c_max_mf.toFixed(2)} mF`,
      ] : []),
    ];
    const hasCC = !!metrics?.complex_cap;
    const headers = ["Freq", "Zreal", "Zimag", "Zmod", "Zphz"];
    const units   = ["Hz",   "Ohm",  "Ohm",  "Ohm",  "deg"];
    if (hasCC) { headers.push("C_prime", "C_dbl"); units.push("mF", "mF"); }

    const eisData = eis!;
    const dataRows: string[] = [];
    for (let i = 0; i < eisData.freq.length; i++) {
      const row = [
        eisData.freq[i].toExponential(4),
        eisData.zreal[i].toFixed(6),
        eisData.zimag[i].toFixed(6),
        eisData.zmod[i].toFixed(6),
        eisData.zphz[i].toFixed(4),
      ];
      if (hasCC && metrics?.complex_cap) {
        const cc = metrics.complex_cap;
        row.push(cc.c_prime[i]?.toFixed(6) ?? "", cc.c_dbl[i]?.toFixed(6) ?? "");
      }
      dataRows.push(row.join(","));
    }
    return [...meta, headers.join(","), units.join(","), ...dataRows].join("\n");
  }, [eis, metrics, file.metadata]);

  const buildTxt = (): string => {
    const values: string[] = [];
    const warnings: string[] = [];
    if (metrics) {
      values.push(
        `ESR: ${metrics.esr.toFixed(3)} Ω  [Z′ at highest measured frequency]`,
        ...(metrics.tau_ms != null ? [`τ₀: ${metrics.tau_ms.toFixed(2)} ms  [f₀ = argmax C″(f); τ₀ = 1/(2π·f₀)]`] : []),
        `C_max: ${metrics.c_max_mf.toFixed(3)} mF  [max C′(f)]`,
        ...(tanDelta?.best ? [
          `tan δ: ${tanDelta.best.val.toFixed(4)} at ${tanDelta.best.freq.toPrecision(4)} Hz  [C″/C′ at the lowest measured frequency]`,
        ] : []),
        ...(metrics.circuit_fit ? [
          "",
          `Equivalent-circuit fit [model: ${MODEL_LABEL[metrics.circuit_fit.model] ?? metrics.circuit_fit.model}, modulus-weighted least squares, ± = 1σ from Jacobian covariance]:`,
          `  R_s: ${fmtPm(metrics.circuit_fit.R_s, metrics.circuit_fit.R_s_err, 4)} Ω`,
          `  R_ct: ${fmtPm(metrics.circuit_fit.R_ct, metrics.circuit_fit.R_ct_err, 4)} Ω`,
          ...(metrics.circuit_fit.C_dl_uF != null ? [`  C_dl: ${fmtPm(metrics.circuit_fit.C_dl_uF, metrics.circuit_fit.C_dl_uF_err, 4)} µF`] : []),
          ...(metrics.circuit_fit.Q != null ? [`  Q: ${fmtPm(metrics.circuit_fit.Q, metrics.circuit_fit.Q_err, 4)} S·s^α`] : []),
          ...(metrics.circuit_fit.alpha != null ? [`  alpha: ${fmtPm(metrics.circuit_fit.alpha, metrics.circuit_fit.alpha_err, 4)}`] : []),
          ...(metrics.circuit_fit.sigma != null ? [`  sigma: ${fmtPm(metrics.circuit_fit.sigma, metrics.circuit_fit.sigma_err, 4)} Ω·s^-½`] : []),
          `  RMSE: ${metrics.circuit_fit.rmse.toFixed(4)} Ω`,
          `  AICc: ${metrics.circuit_fit.aic.toFixed(1)}`,
        ] : []),
      );
      if (tanDelta != null && tanDelta.excluded > 0) {
        warnings.push(`tan δ excluded at ${tanDelta.excluded} frequencies where C′ ≤ 0 or non-finite`);
      }
      if (!metrics.circuit_fit) warnings.push("Equivalent-circuit fit did not converge — no fit parameters reported");
    }
    const definitions = [
      "ESR: Real part of impedance at the highest measured frequency.",
      "C′ / C″: Real and imaginary parts of the complex capacitance,",
      "  C′ = −Z″/(2πf·|Z|²), C″ = Z′/(2πf·|Z|²).",
      "τ₀: Relaxation time from the C″(f) peak, convention τ₀ = 1/(2π·f₀).",
      "tan δ: C″/C′ — dissipation factor, reported at the lowest measured frequency.",
      "R_s, R_ct: Series and charge-transfer resistance of the fitted equivalent circuit.",
      "Q, α: Constant-phase element parameters; α = 1 is an ideal capacitor.",
      "σ: Warburg coefficient (semi-infinite diffusion).",
      "±: 1σ standard error from the fit's Jacobian covariance.",
    ];
    return buildSummaryTxt(
      file.name, "EIS", [
        { title: "Computed values", lines: values },
        { title: "Warnings", lines: warnings.length ? warnings : ["(none)"] },
        { title: "Definitions", lines: definitions },
      ] as SummarySection[],
      `"I have electrochemical impedance spectroscopy data from [describe your system: electrode,\nelectrolyte, DC bias, amplitude]. The computed parameters and their formulas are above.\nPlease help me interpret these values, list possible explanations for any anomalies, and\nsuggest follow-up experiments to distinguish between them."`,
    );
  };

  handleExportRef.current = (fmt: string) => {
    if (fmt === "csv") { downloadCsv(buildCsv(), file.name); return; }
    if (fmt === "txt") { downloadTxt(buildTxt(), file.name); return; }
    exportPlotImage(styledPlotData, finalLayout, file.name, fmt as "png" | "svg", style.exportShape);
  };
  collectRef.current = () => ({
    filename: file.name.replace(/\.dta$/i, ''),
    csv: buildCsv(),
    txt: buildTxt(),
    plotData: styledPlotData,
    layout: finalLayout,
  });

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 bg-panel-header border-b border-panel-border text-xs text-panel-text shrink-0">
        <div className="flex rounded overflow-hidden border border-panel-border">
          {(["nyquist", "bode", "complex_cap"] as View[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2 py-0.5 text-xs transition-colors ${view === v ? "bg-forest-600 text-white" : "text-panel-text hover:bg-panel-bg"}`}>
              {v === "nyquist" ? "Nyquist" : v === "bode" ? "Bode" : "Complex C"}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-panel-muted">Fit</span>
          <select value={fitModel} onChange={e => setFitModel(e.target.value)}
                  className="bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400 text-[10px]">
            <option value="auto">Auto (AICc)</option>
            <option value="randles">Randles</option>
            <option value="randles_cpe">Randles-CPE</option>
            <option value="randles_cpe_warburg">Randles-CPE-Warburg</option>
          </select>
        </label>

        <div className="flex rounded overflow-hidden border border-panel-border shrink-0">
          <button onClick={() => setDragmode('zoom')} title="Box zoom"
            className={`px-2 py-0.5 text-[10px] transition-colors ${dragmode === 'zoom' ? 'bg-forest-600 text-white' : 'text-panel-muted hover:bg-panel-bg'}`}>
            Zoom
          </button>
          <button onClick={() => setDragmode('pan')} title="Drag to pan"
            className={`px-2 py-0.5 text-[10px] transition-colors ${dragmode === 'pan' ? 'bg-forest-600 text-white' : 'text-panel-muted hover:bg-panel-bg'}`}>
            Pan
          </button>
        </div>

        <button onClick={() => setAxesOpen(o => !o)}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${axesOpen ? "bg-forest-600 border-forest-600 text-white" : "border-panel-border text-panel-muted hover:text-panel-text"}`}>
          Axes {axesOpen ? "▴" : "▾"}
        </button>

        {axesOpen && (
          <div className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 border-t border-panel-border">
            <span className="font-semibold text-panel-muted">X</span>
            <AxisInput value={xMin} onChange={setXMin} placeholder="min" className="w-16 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400" />
            <span className="text-panel-muted">–</span>
            <AxisInput value={xMax} onChange={setXMax} placeholder="max" className="w-16 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400" />
            <label className="flex items-center gap-1 cursor-pointer text-panel-muted">
              <input type="checkbox" checked={xLog} onChange={e => setXLog(e.target.checked)} className="accent-forest-400" /> log
            </label>
            <span className="text-panel-muted px-1">│</span>
            <span className="font-semibold text-panel-muted">Y</span>
            <AxisInput value={yMin} onChange={setYMin} placeholder="min" className="w-16 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400" />
            <span className="text-panel-muted">–</span>
            <AxisInput value={yMax} onChange={setYMax} placeholder="max" className="w-16 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400" />
            <label className="flex items-center gap-1 cursor-pointer text-panel-muted">
              <input type="checkbox" checked={yLog} onChange={e => setYLog(e.target.checked)} className="accent-forest-400" /> log
            </label>
            {(xMin || xMax || yMin || yMax) && (
              <button onClick={() => { setXMin(""); setXMax(""); setYMin(""); setYMax(""); }}
                      className="text-[10px] text-panel-muted hover:text-red-500 border border-panel-border rounded px-1.5 py-0.5 transition-colors">
                Reset
              </button>
            )}
            {hasZoom && (
              <button
                onClick={() => {
                  const snap = getRangeSnapshot();
                  if (snap.x) { setXMin(String(+Number(snap.x[0]).toPrecision(5))); setXMax(String(+Number(snap.x[1]).toPrecision(5))); }
                  if (snap.y) { setYMin(String(+Number(snap.y[0]).toPrecision(5))); setYMax(String(+Number(snap.y[1]).toPrecision(5))); }
                }}
                className="text-[10px] text-forest-600 hover:text-forest-400 border border-forest-700/50 rounded px-1.5 py-0.5 transition-colors">
                Lock view
              </button>
            )}
            <div className="w-full flex items-center gap-2 pt-1 border-t border-panel-border">
              <span className="text-[10px] font-semibold text-panel-muted shrink-0">X label</span>
              <input type="text"
                     placeholder={view === "nyquist" ? "Z′ (Ω)" : "Frequency (Hz)"}
                     value={xTitleOverride} onChange={e => setXTitleOverride(e.target.value)}
                     className="flex-1 min-w-0 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400 text-[10px]" />
              <span className="text-[10px] font-semibold text-panel-muted shrink-0">Y label</span>
              <input type="text"
                     placeholder={view === "nyquist" ? "−Z″ (Ω)" : view === "bode" ? "|Z| (Ω)" : "Capacitance (mF)"}
                     value={yTitleOverride} onChange={e => setYTitleOverride(e.target.value)}
                     className="flex-1 min-w-0 bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400 text-[10px]" />
            </div>
          </div>
        )}
      </div>

      {/* Metrics row */}
      {eis && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-1 bg-forest-900/50 border-b border-forest-700/30 shrink-0">
          <span className="text-[10px] text-forest-400">
            {eis.freq[eis.freq.length - 1]?.toPrecision(3)}–{eis.freq[0]?.toPrecision(3)} Hz · {eis.freq.length} pts
          </span>
          {metrics?.circuit_fit && (() => {
            const f = metrics.circuit_fit;
            return (
              <>
                <span className="text-[10px] text-forest-200 bg-forest-700/60 rounded px-2 py-0.5 font-medium">
                  {MODEL_LABEL[f.model] ?? f.model}
                </span>
                <span className="text-[10px] text-[color:var(--chip-text)] bg-[color:var(--chip-bg)] rounded px-2 py-0.5">
                  R_s {fmtPm(f.R_s, f.R_s_err)} Ω
                </span>
                <span className="text-[10px] text-[color:var(--chip-text)] bg-[color:var(--chip-bg)] rounded px-2 py-0.5">
                  R_ct {fmtPm(f.R_ct, f.R_ct_err)} Ω
                </span>
                {f.C_dl_uF != null && (
                  <span className="text-[10px] text-[color:var(--chip-text)] bg-[color:var(--chip-bg)] rounded px-2 py-0.5">
                    C_dl {fmtPm(f.C_dl_uF, f.C_dl_uF_err)} µF
                  </span>
                )}
                {f.Q != null && (
                  <span className="text-[10px] text-[color:var(--chip-text)] bg-[color:var(--chip-bg)] rounded px-2 py-0.5">
                    Q {fmtPm(f.Q, f.Q_err)} S·s^α
                  </span>
                )}
                {f.alpha != null && (
                  <span className="text-[10px] text-[color:var(--chip-text)] bg-[color:var(--chip-bg)] rounded px-2 py-0.5">
                    α {fmtPm(f.alpha, f.alpha_err)}
                  </span>
                )}
                {f.sigma != null && (
                  <span className="text-[10px] text-[color:var(--chip-text)] bg-[color:var(--chip-bg)] rounded px-2 py-0.5">
                    σ {fmtPm(f.sigma, f.sigma_err)} Ω·s^-½
                  </span>
                )}
              </>
            );
          })()}
          {metrics && !metrics.circuit_fit && (
            <span className="text-[10px] text-forest-600">fit did not converge</span>
          )}
          <Tooltip content="Show formulas and definitions" className="ml-auto">
            <button onClick={() => setShowInfo(true)}
                    className="text-[10px] text-forest-500 hover:text-forest-300 border border-forest-700 rounded-full w-4 h-4 flex items-center justify-center transition-colors cursor-pointer shrink-0">
              ?
            </button>
          </Tooltip>
        </div>
      )}

      {showInfo && (
        <InfoModal title="EIS — Calculations" onClose={() => setShowInfo(false)}>
          <Calc name="ESR — Equivalent Series Resistance (Ω)">
            <p>Real part of the impedance at the highest measured frequency. Represents the ohmic resistance of the electrolyte and contact resistances.</p>
            <Formula>{"ESR = Z′(f_max)"}</Formula>
          </Calc>
          <Calc name="Complex capacitance C*(f)">
            <p>Derived from the impedance spectrum:</p>
            <Formula>{"C*(f) = C′(f) − j·C″(f)\n\nC*(f)  = 1 / (j · 2π·f · Z*(f))\nC′(f)  = −Z″(f) / (2π·f · |Z(f)|²)   [real part, mF]\nC″(f)  =  Z′(f) / (2π·f · |Z(f)|²)   [imaginary part, mF]"}</Formula>
          </Calc>
          <Calc name="τ₀ — Relaxation time (ms)">
            <p>The characteristic frequency f₀ is taken from the maximum of C″(f) — not from the tan δ peak. Convention used here: τ₀ = 1/(2π·f₀).</p>
            <Formula>{"f₀  = argmax C″(f)\nτ₀  = 1 / (2π · f₀)   [s, reported in ms]"}</Formula>
          </Calc>
          <Calc name="tan δ — Loss tangent">
            <p>Ratio of the dissipative to the stored capacitive response. Reported at the lowest measured frequency (near-DC limit); at high frequency C′ → 0 and tan δ diverges, so a spectrum-wide maximum is not reported. Frequencies where C′ ≤ 0 or values are non-finite are excluded and a warning is shown.</p>
            <Formula>{"tan δ(f) = C″(f) / C′(f)\nReported at f = f_min of the measured spectrum"}</Formula>
          </Calc>
          <Calc name="C_max — Maximum capacitance (mF)">
            <p>Peak value of C′(f), corresponding to the low-frequency (quasi-DC) capacitance limit of the device.</p>
            <Formula>{"C_max = max(C′(f))"}</Formula>
          </Calc>
          <Calc name="Equivalent-circuit fit">
            <p>Three circuit models are available. The interface is modelled as a series resistance R_s with a parallel combination of charge transfer and capacitive elements.</p>
            <Formula>{"Randles:              Z = R_s + R_ct / (1 + jω·R_ct·C_dl)\nRandles-CPE:          Z = R_s + R_ct / (1 + (jω)^α·Q·R_ct)\nRandles-CPE-Warburg:  Z = R_s + 1/((jω)^α·Q + 1/(R_ct + Z_W))"}</Formula>
            <p>The constant-phase element (CPE) generalises the ideal capacitor to account for surface inhomogeneity; α = 1 recovers an ideal capacitor with Q = C.</p>
            <Formula>{"Z_CPE = 1 / ((jω)^α · Q)     α ∈ [0.3, 1]"}</Formula>
            <p>The Warburg element models semi-infinite linear diffusion, visible as a 45° tail at low frequency.</p>
            <Formula>{"Z_W = σ·(1 − j) / √ω"}</Formula>
            <p>Fitted via modulus-weighted nonlinear least squares. In Auto mode all three models are fitted and the one with the lowest AICc (Akaike information criterion, small-sample corrected) is selected — this penalises extra parameters so a more complex circuit must earn its keep.</p>
          </Calc>
          <Calc name="Parameter uncertainties (±)">
            <p>Reported uncertainties are 1σ standard errors estimated from the Jacobian covariance of the least-squares fit. They quantify the precision of the fit, not systematic errors in the measurement. "± —" means the covariance was singular (typically an over-parametrised model for this dataset).</p>
          </Calc>
        </InfoModal>
      )}

      {/* Plot */}
      <div ref={plotRef} className="relative flex-1 min-h-0">
        {eisQ.isError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertTriangle size={24} className="text-amber-400 shrink-0" />
            <p className="text-xs text-forest-400 max-w-xs leading-relaxed">
              Analysis failed — check the file or retry.
            </p>
          </div>
        ) : eisQ.isLoading ? (
          <div className="absolute inset-0 flex flex-col gap-3 p-4 animate-pulse">
            <div className="h-3 bg-forest-700/40 rounded w-3/4" />
            <div className="flex-1 bg-forest-700/20 rounded" />
            <div className="h-3 bg-forest-700/40 rounded w-1/2" />
          </div>
        ) : (
          <div className="absolute inset-0">
            <Plot key={plotKey} data={styledPlotData} layout={finalLayout} onRelayout={onRelayout as never}
                  config={{ responsive: true, displayModeBar: "hover", displaylogo: false, scrollZoom: true, edits: { legendPosition: true } }}
                  style={{ width: "100%", height: "100%" }} useResizeHandler />
          </div>
        )}
      </div>
    </div>
  );
}
