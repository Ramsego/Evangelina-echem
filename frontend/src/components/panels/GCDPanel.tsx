import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Plot from "react-plotly.js";
import { useQuery } from "@tanstack/react-query";
import { analyzeGCD, fetchGCDCycle } from "../../api/client";
import { ParsedFile } from "../../types";
import InfoModal, { Calc, Formula } from "../InfoModal";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useDebounce } from "../../hooks/useDebounce";
import { useZoom } from "../../hooks/useZoom";
import { useStyle, useStyleContext } from "../../context/StyleContext";
import { applyStyleToData, applyStyleToLayout, resolveLegendFontSize } from "../../utils/applyStyle";
import { useExportContext, CollectResult } from "../../context/ExportContext";
import { exportPlotImage, downloadCsv, downloadTxt, buildSummaryTxt, metaComments, SummarySection } from "../../utils/exportUtils";
import { useContainerSize } from "../../hooks/useContainerSize";
import { computeExtents, computeDQDVFromCurrents, computeVQ, axisOverride, LAYOUT_BASE as SHARED_LAYOUT_BASE } from "../../utils/plotUtils";
import { useZoomClamp } from "../../hooks/useZoomClamp";
import AxisInput from "../AxisInput";
import Tooltip from "../Tooltip";
import { AlertTriangle } from "lucide-react";
import { median, computeGcdEsr, findDqdvPeaks, EsrResult } from "../../utils/gcdUtils";
import { normDivisor } from "../../utils/normalization";

const COLORS = ["#74C69D","#D4A057","#60a5fa","#f472b6","#a78bfa","#fbbf24","#34d399","#f87171"];

// Wider right margin for the secondary CE% axis; bordered legend as in EISPanel
const LAYOUT_BASE: Partial<Plotly.Layout> = {
  ...SHARED_LAYOUT_BASE,
  margin: { l: 56, r: 56, t: 10, b: 48 },
  legend: { bgcolor: "rgba(11,22,16,0.85)", bordercolor: "#1B4332", borderwidth: 1, font: { color: "#A8D5BA", size: 11 } },
};

type GCDView = "cyclelife" | "profiles" | "dqdv" | "energy";

const inputCls = "bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400";
const chipCls  = "text-[10px] text-[color:var(--chip-text)] bg-[color:var(--chip-bg)] rounded px-2 py-0.5";
const warnCls  = "text-[10px] text-amber-500 bg-amber-400/10 border border-amber-400/40 rounded px-2 py-0.5";

interface Props { file: ParsedFile }

export default function GCDPanel({ file }: Props) {
  const style = useStyle(file.id);
  const gcd   = file.gcd;
  const hasRaw = !!file.total_gcd_cycles;
  const totalCycles = file.total_gcd_cycles ?? gcd?.cycles.length ?? 0;

  // ── Shared state ─────────────────────────────────────────────────────────────
  const [view,     setView]     = useLocalStorage<GCDView>(`${file.id}.gcdView`, "cyclelife");
  const [norm,     setNorm]     = useLocalStorage<"none"|"area"|"mass">(`${file.id}.norm`, "none");
  const [normVal,  setNormVal]  = useLocalStorage(`${file.id}.normVal`, 1.0);
  const [showInfo, setShowInfo] = useState(false);
  const [axesOpen, setAxesOpen] = useState(false);
  const [dragmode, setDragmode] = useState<'zoom'|'pan'>('zoom');
  const [xMin, setXMin] = useState("");
  const [xMax, setXMax] = useState("");
  const [yMin, setYMin] = useState("");
  const [yMax, setYMax] = useState("");
  const [y2Min, setY2Min] = useState("");
  const [y2Max, setY2Max] = useState("");
  const [xLog, setXLog] = useState(false);
  const [yLog, setYLog] = useState(false);
  const [xTitleOverride, setXTitleOverride] = useState("");
  const [yTitleOverride, setYTitleOverride] = useState("");
  const [y2TitleOverride, setY2TitleOverride] = useState("");

  // ── Profiles / dQ/dV cycle range ─────────────────────────────────────────────
  const [loDraft, setLo] = useState(1);
  const [hiDraft, setHi] = useState(Math.min(3, totalCycles));
  const lo = useDebounce(loDraft, 150);
  const hi = useDebounce(hiDraft, 150);
  const [showCharge, setShowCharge]       = useState(false);
  const [showDischarge, setShowDischarge] = useState(true);

  // ── dQ/dV state ───────────────────────────────────────────────────────────────
  const [dqdvCycleDraft, setDqdvCycleDraft] = useState(1);
  const dqdvCycle  = useDebounce(dqdvCycleDraft, 150);
  const [dqdvStep, setDqdvStep]             = useLocalStorage<"charge"|"discharge">(`${file.id}.dqdvStep`, "discharge");
  const [smoothWindow, setSmoothWindow]     = useState(5);
  const [showPeaks, setShowPeaks]           = useState(true);
  const [peakThr, setPeakThr]               = useState(20);  // % of max |dQ/dV|

  // ── Reset axes on view change ─────────────────────────────────────────────────
  useEffect(() => {
    setXMin(""); setXMax(""); setYMin(""); setYMax(""); setY2Min(""); setY2Max("");
    setXLog(false); setYLog(false);
    setXTitleOverride(""); setYTitleOverride(""); setY2TitleOverride("");
    setAxesOpen(false);
  }, [view]);

  // ── Normalization divisor ─────────────────────────────────────────────────────
  const qDivisor  = normDivisor(norm, normVal);
  const qLabel    = norm === "area" ? "Capacity (mAh/cm²)"
                  : norm === "mass" ? "Capacity (mAh/g)"
                  : "Capacity (mAh)";
  const eLabel    = norm === "area" ? "Energy (mWh/cm²)"
                  : norm === "mass" ? "Energy (mWh/g)"
                  : "Energy (mWh)";

  // ── Cycle Life: GCD summary analysis ─────────────────────────────────────────
  const gcdQ = useQuery({
    queryKey: ["gcd", file.id],
    queryFn:  () => analyzeGCD({
      cycles:          gcd!.cycles,
      discharge_caps:  gcd!.discharge_caps,
      charge_by_cycle: gcd!.charge_by_cycle,
      dis_energy_mwh:  gcd!.dis_energy_mwh ?? {},
      ch_energy_mwh:   gcd!.ch_energy_mwh ?? {},
    }),
    enabled: !!gcd && view === "cyclelife",
  });

  // ── Profiles: fetch selected cycle range (up to 5) ──────────────────────────
  const profileCycles = useMemo(
    () => Array.from({ length: Math.min(hi - lo + 1, 5) }, (_, i) => lo + i).filter(c => c <= totalCycles),
    [lo, hi, totalCycles]
  );
  const profileQ = useQuery({
    queryKey: ["gcd-profiles", file.id, profileCycles],
    queryFn:  () => Promise.all(profileCycles.map(c => fetchGCDCycle(file.id, c))),
    enabled:  hasRaw && view === "profiles" && profileCycles.length > 0,
  });

  // ── dQ/dV: fetch single cycle ────────────────────────────────────────────────
  const dqdvQ = useQuery({
    queryKey: ["gcd-dqdv", file.id, dqdvCycle],
    queryFn:  () => fetchGCDCycle(file.id, dqdvCycle),
    enabled:  hasRaw && view === "dqdv",
  });

  // ── Hooks (must be before early returns) ─────────────────────────────────────
  const { register, unregister } = useExportContext();
  const handleExportRef = useRef<(fmt: string) => void>(() => {});
  const collectRef      = useRef<() => CollectResult>(() => ({ filename: '', csv: '', plotData: [], layout: {} }));
  const uiRevKey = `${file.id}-${view}-${lo}-${hi}-${dqdvCycle}`;
  const { onRelayout: zoomOnRelayout, legendState, hasZoom, getRangeSnapshot } = useZoom(uiRevKey);
  const [plotRef, plotSize] = useContainerSize();
  const { setLegendAutoSize } = useStyleContext();

  useEffect(() => {
    register(file.id, fmt => handleExportRef.current(fmt), () => collectRef.current());
    return () => unregister(file.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ESR from first selected profile cycle ────────────────────────────────────
  const esrResult = useMemo((): EsrResult | null => {
    if (view !== "profiles" || !showCharge || !showDischarge) return null;
    const cd = profileQ.data?.[0];
    if (!cd || !cd.charge.times.length || !cd.discharge.times.length) return null;
    return computeGcdEsr(cd.cycle, cd.charge, cd.discharge);
  }, [view, showCharge, showDischarge, profileQ.data]);

  // ── dQ/dV curve + peak detection ─────────────────────────────────────────────
  const dqdvCurve = useMemo(() => {
    if (view !== "dqdv" || !dqdvQ.data) return null;
    const step = dqdvStep === "charge" ? dqdvQ.data.charge : dqdvQ.data.discharge;
    if (!step.times.length) return null;
    return computeDQDVFromCurrents(step.times, step.voltages, step.currents, smoothWindow);
  }, [view, dqdvQ.data, dqdvStep, smoothWindow]);

  const dqdvPeaks = useMemo(() => {
    if (!dqdvCurve || !showPeaks) return null;
    const res = findDqdvPeaks(dqdvCurve.v, dqdvCurve.dqdv, peakThr / 100);
    // Width of the tallest peak at half its height, in points — if the smoothing
    // window is comparable or larger, real features may be merged or suppressed
    if (res.peaks.length > 0 && smoothWindow > 1) {
      const tallest = res.peaks.reduce((a, b) => Math.abs(a.y) > Math.abs(b.y) ? a : b);
      const ti = dqdvCurve.v.indexOf(tallest.v);
      const half = Math.abs(tallest.y) / 2;
      let w = 1;
      for (let i = ti - 1; i >= 0 && Math.abs(dqdvCurve.dqdv[i]) > half; i--) w++;
      for (let i = ti + 1; i < dqdvCurve.dqdv.length && Math.abs(dqdvCurve.dqdv[i]) > half; i++) w++;
      if (smoothWindow > w) res.warnings.push("smoothing window exceeds peak width — peaks may be merged or suppressed");
    }
    return res;
  }, [dqdvCurve, showPeaks, peakThr, smoothWindow]);

  // ── Plot data ─────────────────────────────────────────────────────────────────
  const metrics   = gcdQ.data;
  const disMah    = useMemo(
    () => metrics?.dis_mah ?? gcd?.discharge_caps.map((c: number) => c / 3600 * 1000) ?? [],
    [metrics, gcd]
  );
  const ceVals = useMemo(() => metrics?.ce_vals ?? [], [metrics]);
  const normalizedCap = useMemo((): number[] =>
    norm === "area" ? disMah.map((v: number) => v / normVal)
    : norm === "mass" ? disMah.map((v: number) => v / (normVal / 1000))
    : disMah,
    [disMah, norm, normVal]
  );

  const plotData = useMemo((): Plotly.Data[] => {
    if (!gcd) return [];

    // ── Cycle Life ──────────────────────────────────────────────────────────────
    if (view === "cyclelife") {
      const data: Plotly.Data[] = [
        { x: gcd.cycles, y: normalizedCap, type: "scatter", mode: "lines+markers",
          name: "Discharge", line: { color: COLORS[0], width: 2 }, marker: { color: COLORS[0], size: 4 }, yaxis: "y" },
      ];
      // Charge capacity overlay
      const chargeMah = gcd.cycles.map((c: number) => {
        const v = gcd.charge_by_cycle[String(c)];
        if (v == null) return null;
        const mah = v / 3600 * 1000;
        return norm === "area" ? mah / normVal : norm === "mass" ? mah / (normVal / 1000) : mah;
      });
      if (chargeMah.some(v => v != null)) {
        data.push({
          x: gcd.cycles.filter((_: number, i: number) => chargeMah[i] != null),
          y: chargeMah.filter((v: number | null) => v != null) as number[],
          type: "scatter", mode: "lines+markers", name: "Charge",
          line: { color: COLORS[2], width: 1.5, dash: "dot" }, marker: { color: COLORS[2], size: 4 }, yaxis: "y",
        });
      }
      if (ceVals.some((v: number | null) => v != null)) {
        data.push({
          x: gcd.cycles.filter((_: number, i: number) => ceVals[i] != null),
          y: ceVals.filter((v: number | null) => v != null) as number[],
          type: "scatter", mode: "lines+markers", name: "CE (%)",
          line: { color: COLORS[1], width: 1.5, dash: "dot" }, marker: { color: COLORS[1], size: 4 }, yaxis: "y2",
        });
      }
      return data;
    }

    // ── Profiles ────────────────────────────────────────────────────────────────
    if (view === "profiles" && profileQ.data) {
      const data: Plotly.Data[] = [];
      profileQ.data.forEach((cycleData, idx) => {
        const color = COLORS[idx % COLORS.length];
        if (showDischarge && cycleData.discharge.times.length) {
          const { q, v } = computeVQ(cycleData.discharge.times, cycleData.discharge.voltages, cycleData.discharge.currents, qDivisor);
          data.push({ x: q, y: v, type: "scatter", mode: "lines", name: `Cycle ${cycleData.cycle} dis`,
            line: { color, width: 1.8 } });
        }
        if (showCharge && cycleData.charge.times.length) {
          const { q, v } = computeVQ(cycleData.charge.times, cycleData.charge.voltages, cycleData.charge.currents, qDivisor);
          data.push({ x: q, y: v, type: "scatter", mode: "lines", name: `Cycle ${cycleData.cycle} chg`,
            line: { color, width: 1.8, dash: "dot" } });
        }
      });
      // Mark the two points used for the IR-drop measurement
      if (esrResult?.esr != null && profileQ.data[0]) {
        const cd  = profileQ.data[0];
        const off = 2;
        const qCh  = computeVQ(cd.charge.times, cd.charge.voltages, cd.charge.currents, qDivisor).q;
        const qDis = computeVQ(cd.discharge.times, cd.discharge.voltages, cd.discharge.currents, qDivisor).q;
        data.push({
          x: [qCh[qCh.length - 1 - off], qDis[off]],
          y: [esrResult.vChg!, esrResult.vDis!],
          type: "scatter", mode: "markers", name: "IR drop points",
          marker: { color: "#D4A057", size: 9, symbol: "diamond" },
        });
      }
      return data;
    }

    // ── dQ/dV ────────────────────────────────────────────────────────────────────
    if (view === "dqdv") {
      if (!dqdvCurve) return [];
      const data: Plotly.Data[] = [{ x: dqdvCurve.v, y: dqdvCurve.dqdv, type: "scatter", mode: "lines",
        name: `dQ/dV (cycle ${dqdvCycle} ${dqdvStep})`,
        line: { color: dqdvStep === "discharge" ? COLORS[0] : COLORS[2], width: 1.8 } }];
      if (dqdvPeaks && dqdvPeaks.peaks.length > 0) {
        data.push({
          x: dqdvPeaks.peaks.map(p => p.v),
          y: dqdvPeaks.peaks.map(p => p.y),
          type: "scatter", mode: "text+markers", name: "Apparent peaks",
          marker: { color: "#D4A057", size: 8, symbol: "diamond" },
          text: dqdvPeaks.peaks.map(p => `${(p.v * 1000).toFixed(0)} mV`),
          textposition: dqdvPeaks.peaks.map(p => (p.y >= 0 ? "top center" : "bottom center")) as never,
          textfont: { color: "#D4A057", size: 10 },
        });
      }
      return data;
    }

    // ── Energy ───────────────────────────────────────────────────────────────────
    if (view === "energy" && gcd.dis_energy_mwh) {
      const entries = Object.entries(gcd.dis_energy_mwh)
        .map(([c, e]) => ({ cycle: Number(c), e: (e as number) / qDivisor }))
        .sort((a, b) => a.cycle - b.cycle);
      return [{ x: entries.map(e => e.cycle), y: entries.map(e => e.e),
        type: "scatter", mode: "lines+markers", name: "Discharge energy",
        line: { color: COLORS[0], width: 2 }, marker: { color: COLORS[0], size: 4 } }];
    }

    return [];
  }, [view, gcd, normalizedCap, ceVals, profileQ.data, dqdvCurve, dqdvPeaks, esrResult,
      showCharge, showDischarge, qDivisor, dqdvStep, dqdvCycle, norm, normVal]);

  // ── Layout ────────────────────────────────────────────────────────────────────
  const rawLayout = useMemo((): Partial<Plotly.Layout> => {
    const base = { ...LAYOUT_BASE };
    if (view === "cyclelife") return {
      ...base,
      xaxis:  { ...base.xaxis, title: { text: xTitleOverride || "Cycle", font: { color: "#74C69D" } }, ...axisOverride(xMin, xMax, xLog) },
      yaxis:  { ...base.yaxis, title: { text: yTitleOverride || qLabel, font: { color: "#74C69D" } }, ...axisOverride(yMin, yMax, yLog) },
      yaxis2: { title: { text: y2TitleOverride || "CE (%)", font: { color: "#D4A057" } },
                overlaying: "y", side: "right",
                ...(y2Min !== "" || y2Max !== "" ? { range: [Number(y2Min) || 0, Number(y2Max) || 110], autorange: false as const } : { range: [0, 110] }),
                gridcolor: "#1B4332", linecolor: "#2D6A4F", tickfont: { color: "#D4A057" } },
    };
    if (view === "profiles") return {
      ...base, margin: { ...base.margin, r: 16 },
      xaxis: { ...base.xaxis, title: { text: xTitleOverride || qLabel, font: { color: "#74C69D" } }, ...axisOverride(xMin, xMax, xLog) },
      yaxis: { ...base.yaxis, title: { text: yTitleOverride || "Voltage (V)", font: { color: "#74C69D" } }, ...axisOverride(yMin, yMax, yLog) },
    };
    if (view === "dqdv") return {
      ...base, margin: { ...base.margin, r: 16 },
      xaxis: { ...base.xaxis, title: { text: xTitleOverride || "Voltage (V)", font: { color: "#74C69D" } }, ...axisOverride(xMin, xMax, xLog) },
      yaxis: { ...base.yaxis, title: { text: yTitleOverride || "dQ/dV (mAh/V)", font: { color: "#74C69D" } }, ...axisOverride(yMin, yMax, yLog) },
    };
    // energy
    return {
      ...base, margin: { ...base.margin, r: 16 },
      xaxis: { ...base.xaxis, title: { text: xTitleOverride || "Cycle", font: { color: "#74C69D" } }, ...axisOverride(xMin, xMax, xLog) },
      yaxis: { ...base.yaxis, title: { text: yTitleOverride || eLabel, font: { color: "#74C69D" } }, ...axisOverride(yMin, yMax, yLog) },
    };
  }, [view, xTitleOverride, yTitleOverride, y2TitleOverride, xMin, xMax, xLog, yMin, yMax, yLog, y2Min, y2Max, qLabel, eLabel]);

  const styledData      = useMemo(() => applyStyleToData(plotData, style),    [plotData, style]);
  const extents         = useMemo(() => { const e = computeExtents(styledData); return e ? { ...e, xIsLog: xLog, yIsLog: yLog } : null; }, [styledData, xLog, yLog]);
  const { onRelayout, clamp, uirevision, plotKey } = useZoomClamp(extents, zoomOnRelayout, uiRevKey);
  const styledLayout    = useMemo(() => applyStyleToLayout(rawLayout, style), [rawLayout, style]);
  const legendFontSize  = resolveLegendFontSize(style, plotSize);
  useEffect(() => { setLegendAutoSize(file.id, legendFontSize); }, [file.id, legendFontSize, setLegendAutoSize]);
  const finalLayout     = useMemo((): Partial<Plotly.Layout> => ({
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

  if (!gcd) return (
    <div className="flex-1 flex items-center justify-center text-forest-600 text-sm">No GCD data</div>
  );

  // ── Export ────────────────────────────────────────────────────────────────────
  const buildCsv = useCallback((): string => {
    const meta = [
      ...metaComments(file.metadata),
      ...(norm !== "none" ? [`# Normalised by ${norm === "area" ? `area: ${normVal} cm2` : `mass: ${normVal} mg`}`] : []),
      ...(metrics ? [`# Fade: ${metrics.fade_pct.toFixed(1)}%  Avg CE: ${metrics.avg_ce.toFixed(1)}%`] : []),
    ];
    const hasCE = ceVals.some((v: number | null) => v != null);
    const headers = ["Cycle", "Discharge_Cap", ...(norm !== "none" ? [norm === "area" ? "Specific_Cap_area" : "Specific_Cap_mass"] : []), ...(hasCE ? ["CE"] : [])];
    const units   = ["", "mAh", ...(norm !== "none" ? [norm === "area" ? "mAh/cm2" : "mAh/g"] : []), ...(hasCE ? ["%"] : [])];
    const rows = gcd!.cycles.map((cycle: number, i: number) => {
      const row = [cycle.toString(), disMah[i].toFixed(6)];
      if (norm !== "none") row.push(normalizedCap[i].toFixed(6));
      if (hasCE) row.push(ceVals[i] != null ? (ceVals[i] as number).toFixed(2) : "");
      return row.join(",");
    });
    return [...meta, headers.join(","), units.join(","), ...rows].join("\n");
  }, [gcd, disMah, normalizedCap, ceVals, norm, normVal, metrics, file.metadata]);

  const buildTxt = (): string => {
    const values: string[] = [];
    const warnings: string[] = [];
    if (metrics) {
      values.push(
        `Cycles: ${gcd!.cycles.length} (${gcd!.cycles[0]}–${gcd!.cycles[gcd!.cycles.length - 1]})`,
        `First / last discharge capacity: ${disMah[0]?.toFixed(4)} / ${disMah[disMah.length - 1]?.toFixed(4)} mAh`,
        `Fade: ${metrics.fade_pct.toFixed(2)}%  [(Q_dis,1 − Q_dis,N) / Q_dis,1 × 100]`,
        `Average CE: ${metrics.avg_ce.toFixed(2)}%  [CE = Q_dis / Q_ch × 100 per cycle]`,
        ...(metrics.avg_energy_eff != null
          ? [`Average energy efficiency η: ${metrics.avg_energy_eff.toFixed(2)}%  [η = E_dis / E_ch × 100 per cycle]`]
          : []),
        ...(norm !== "none" ? [`Normalisation: by ${norm} (${normVal} ${norm === "area" ? "cm²" : "mg"})`] : []),
      );
      if (metrics.avg_energy_eff == null) warnings.push("charge energy not present in file — energy efficiency not computed");
    }
    if (esrResult) {
      if (esrResult.esr != null) {
        values.push(
          "",
          `IR drop (cycle ${esrResult.cycle}): ΔV = ${(esrResult.dV! * 1000).toFixed(2)} mV`,
          `  measured between V = ${esrResult.vChg!.toFixed(4)} V (end of charge, 2 points before reversal)`,
          `  and V = ${esrResult.vDis!.toFixed(4)} V (start of discharge, 2 points after reversal)`,
          `ESR (GCD): ${esrResult.esr.toFixed(4)} Ω  [ESR = ΔV / |ΔI|, current step from waveform]`,
        );
      }
      warnings.push(...esrResult.warnings);
    }
    if (view === "dqdv" && dqdvPeaks) {
      if (dqdvPeaks.peaks.length > 0) {
        values.push(
          "",
          `dQ/dV apparent peaks (cycle ${dqdvCycle}, ${dqdvStep} step, smoothing window ${smoothWindow}, threshold ${peakThr}% of max |dQ/dV|):`,
          ...dqdvPeaks.peaks.map(p => `  ${(p.v * 1000).toFixed(0)} mV  (dQ/dV = ${p.y.toFixed(4)} mAh/V)`),
        );
      }
      warnings.push(...dqdvPeaks.warnings);
    }
    const definitions = [
      "Discharge capacity: Q = I × t over the discharge step, in mAh.",
      "CE (coulombic efficiency): Q_dis / Q_ch × 100 per cycle.",
      "Fade: Capacity loss from the first to the last cycle, as % of the first.",
      "η (energy efficiency): E_dis / E_ch × 100 per cycle, with E = ∫V·|I| dt.",
      "ESR (GCD): Voltage jump at the current reversal divided by the magnitude of the",
      "  current step. Derived from the time-domain waveform; reported separately from",
      "  any EIS-derived resistance.",
      "dQ/dV apparent peak voltage: Voltage of a local extremum of the smoothed",
      "  differential capacity curve. Depends on smoothing and measurement conditions.",
    ];
    return buildSummaryTxt(
      file.name, "GCD", [
        { title: "Computed values", lines: values },
        { title: "Warnings", lines: warnings.length ? warnings : ["(none)"] },
        { title: "Definitions", lines: definitions },
      ] as SummarySection[],
      `"I have galvanostatic charge–discharge data from [describe your system: chemistry,\nelectrode, current/C-rate, voltage window]. The computed parameters and their formulas\nare above. Please help me interpret these values, list possible explanations for any\nanomalies, and suggest follow-up experiments to distinguish between them."`,
    );
  };

  handleExportRef.current = (fmt: string) => {
    if (fmt === "csv") { downloadCsv(buildCsv(), file.name); return; }
    if (fmt === "txt") { downloadTxt(buildTxt(), file.name); return; }
    exportPlotImage(styledData, finalLayout, file.name, fmt as "png" | "svg", style.exportShape);
  };
  collectRef.current = () => ({
    filename: file.name.replace(/\.dta$/i, ''),
    csv: buildCsv(),
    txt: buildTxt(),
    plotData: styledData,
    layout: finalLayout,
  });

  // ── Loading / error state for waveform views ──────────────────────────────────
  const waveformLoading = (view === "profiles"   && profileQ.isLoading)
                       || (view === "dqdv"       && dqdvQ.isLoading)
                       || (view === "cyclelife"  && gcdQ.isLoading);
  const waveformError   = (view === "profiles"   && profileQ.isError)
                       || (view === "dqdv"       && dqdvQ.isError)
                       || (view === "cyclelife"  && gcdQ.isError);

  // ── Axes panel (shared across views) ─────────────────────────────────────────
  const axesPanel = axesOpen && (
    <div className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 border-t border-panel-border">
      <span className="font-semibold text-panel-muted">X</span>
      <AxisInput value={xMin} onChange={setXMin} placeholder="min" className={`w-16 ${inputCls}`} />
      <span className="text-panel-muted">–</span>
      <AxisInput value={xMax} onChange={setXMax} placeholder="max" className={`w-16 ${inputCls}`} />
      <label className="flex items-center gap-1 cursor-pointer text-panel-muted">
        <input type="checkbox" checked={xLog} onChange={e => setXLog(e.target.checked)} className="accent-forest-400" /> log
      </label>
      <span className="text-panel-muted px-1">│</span>
      <span className="font-semibold text-panel-muted">Y</span>
      <AxisInput value={yMin} onChange={setYMin} placeholder="min" className={`w-16 ${inputCls}`} />
      <span className="text-panel-muted">–</span>
      <AxisInput value={yMax} onChange={setYMax} placeholder="max" className={`w-16 ${inputCls}`} />
      <label className="flex items-center gap-1 cursor-pointer text-panel-muted">
        <input type="checkbox" checked={yLog} onChange={e => setYLog(e.target.checked)} className="accent-forest-400" /> log
      </label>
      {view === "cyclelife" && <>
        <span className="text-panel-muted px-1">│</span>
        <span className="font-semibold text-panel-muted">Y2</span>
        <AxisInput value={y2Min} onChange={setY2Min} placeholder="0"   className={`w-16 ${inputCls}`} />
        <span className="text-panel-muted">–</span>
        <AxisInput value={y2Max} onChange={setY2Max} placeholder="110" className={`w-16 ${inputCls}`} />
      </>}
      {(xMin || xMax || yMin || yMax || y2Min || y2Max) && (
        <button onClick={() => { setXMin(""); setXMax(""); setYMin(""); setYMax(""); setY2Min(""); setY2Max(""); }}
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
        <input type="text" value={xTitleOverride} onChange={e => setXTitleOverride(e.target.value)}
               className={`flex-1 min-w-0 ${inputCls} text-[10px]`} />
        <span className="text-[10px] font-semibold text-panel-muted shrink-0">Y label</span>
        <input type="text" value={yTitleOverride} onChange={e => setYTitleOverride(e.target.value)}
               className={`flex-1 min-w-0 ${inputCls} text-[10px]`} />
        {view === "cyclelife" && <>
          <span className="text-[10px] font-semibold text-panel-muted shrink-0">Y2 label</span>
          <input type="text" value={y2TitleOverride} onChange={e => setY2TitleOverride(e.target.value)}
                 className={`flex-1 min-w-0 ${inputCls} text-[10px]`} />
        </>}
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 bg-panel-header border-b border-panel-border text-xs text-panel-text shrink-0">

        {/* View toggle */}
        <div className="flex rounded overflow-hidden border border-panel-border">
          {(["cyclelife", "profiles", "dqdv", "energy"] as GCDView[]).map(v => {
            const label = v === "cyclelife" ? "Cycle Life" : v === "profiles" ? "Profiles" : v === "dqdv" ? "dQ/dV" : "Energy";
            const disabled = (v !== "cyclelife") && !hasRaw && !(v === "energy" && gcd.dis_energy_mwh);
            return (
              <button key={v} onClick={() => !disabled && setView(v)} disabled={disabled}
                className={`px-2 py-0.5 text-[10px] transition-colors ${view === v ? "bg-forest-600 text-white" : disabled ? "text-panel-muted cursor-default" : "text-panel-text hover:bg-panel-bg"}`}
                title={disabled ? "Re-upload file to enable" : undefined}>
                {label}
              </button>
            );
          })}
        </div>

        {/* View-specific controls */}
        {view === "profiles" && hasRaw && (
          <>
            <span className="text-panel-muted text-[10px]">Cycles</span>
            <input type="number" value={loDraft} min={1} max={hiDraft}
                   onChange={e => setLo(Number(e.target.value))}
                   className={`w-12 ${inputCls}`} />
            <span className="text-panel-muted">–</span>
            <input type="number" value={hiDraft} min={loDraft} max={totalCycles}
                   onChange={e => setHi(Math.min(Number(e.target.value), loDraft + 4))}
                   className={`w-12 ${inputCls}`} />
            <span className="text-panel-muted text-[9px]">of {totalCycles} (max 5)</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={showDischarge} onChange={e => setShowDischarge(e.target.checked)} className="accent-forest-400" />
              <span className="text-[10px]">Discharge</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={showCharge} onChange={e => setShowCharge(e.target.checked)} className="accent-forest-400" />
              <span className="text-[10px]">Charge</span>
            </label>
          </>
        )}

        {view === "dqdv" && hasRaw && (
          <>
            <span className="text-panel-muted text-[10px]">Cycle</span>
            <input type="number" value={dqdvCycleDraft} min={1} max={totalCycles}
                   onChange={e => setDqdvCycleDraft(Number(e.target.value))}
                   className={`w-14 ${inputCls}`} />
            <div className="flex rounded overflow-hidden border border-panel-border">
              {(["discharge", "charge"] as const).map(s => (
                <button key={s} onClick={() => setDqdvStep(s)}
                  className={`px-2 py-0.5 text-[10px] transition-colors capitalize ${dqdvStep === s ? "bg-forest-600 text-white" : "text-panel-muted hover:bg-panel-bg"}`}>
                  {s}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1">
              <Tooltip content="Smoothing window — points averaged to reduce noise" side="bottom">
                <span className="text-[10px] text-panel-muted">Smooth</span>
              </Tooltip>
              <input type="range" min={1} max={50} value={smoothWindow}
                     onChange={e => setSmoothWindow(Number(e.target.value))}
                     className="w-20 accent-forest-400" />
              <span className="text-[10px] text-panel-muted w-5">{smoothWindow}</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={showPeaks} onChange={e => setShowPeaks(e.target.checked)} className="accent-forest-400" />
              <span className="text-[10px]">Peaks</span>
            </label>
            {showPeaks && (
              <label className="flex items-center gap-1">
                <Tooltip content="Peak threshold as % of max |dQ/dV| — higher hides small peaks" side="bottom">
                  <span className="text-[10px] text-panel-muted">Thr</span>
                </Tooltip>
                <input type="number" value={peakThr} min={1} max={90}
                       onChange={e => setPeakThr(Number(e.target.value))}
                       className={`w-12 ${inputCls}`} />
                <span className="text-[10px] text-panel-muted">%</span>
              </label>
            )}
          </>
        )}

        {/* Normalization (all views) */}
        <select value={norm} onChange={e => setNorm(e.target.value as "none"|"area"|"mass")}
                className={inputCls}>
          <option value="none">No normalisation</option>
          <option value="area">By area (cm²)</option>
          <option value="mass">By mass (mg)</option>
        </select>
        {norm !== "none" && (
          <input type="number" value={normVal} min={0.001} step={0.01}
                 onChange={e => setNormVal(Number(e.target.value))}
                 className={`w-16 ${inputCls}`} />
        )}

        {/* Zoom/Pan */}
        <div className="flex rounded overflow-hidden border border-panel-border shrink-0">
          <button onClick={() => setDragmode('zoom')}
            className={`px-2 py-0.5 text-[10px] transition-colors ${dragmode === 'zoom' ? 'bg-forest-600 text-white' : 'text-panel-muted hover:bg-panel-bg'}`}>Zoom</button>
          <button onClick={() => setDragmode('pan')}
            className={`px-2 py-0.5 text-[10px] transition-colors ${dragmode === 'pan' ? 'bg-forest-600 text-white' : 'text-panel-muted hover:bg-panel-bg'}`}>Pan</button>
        </div>

        <button onClick={() => setAxesOpen(o => !o)}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${axesOpen ? "bg-forest-600 border-forest-600 text-white" : "border-panel-border text-panel-muted hover:text-panel-text"}`}>
          Axes {axesOpen ? "▴" : "▾"}
        </button>

        {(view === "cyclelife" || view === "profiles") && (
          <Tooltip content="Show formulas and definitions" side="bottom" className="ml-auto">
            <button onClick={() => setShowInfo(true)}
                    className="text-[10px] text-panel-muted hover:text-panel-text border border-panel-border rounded-full w-4 h-4 flex items-center justify-center transition-colors shrink-0">?</button>
          </Tooltip>
        )}

        {axesPanel}
      </div>

      {/* Status line */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-0.5 bg-forest-900/50 border-b border-forest-700/20 shrink-0 text-[10px] text-panel-muted">
        <span>{totalCycles} cycles · {view === "cyclelife" ? "cycle life" : view === "profiles" ? "profiles" : view === "dqdv" ? "dQ/dV" : "energy"}</span>
        {view === "profiles" && esrResult && esrResult.esr != null && (
          <>
            <span className={chipCls} title="ΔV at current reversal">IR drop = {((esrResult.dV ?? 0) * 1000).toFixed(1)} mV</span>
            <span className={chipCls} title="ESR = ΔV / |ΔI|">ESR = {esrResult.esr.toFixed(3)} Ω</span>
          </>
        )}
        {view === "profiles" && esrResult?.warnings.map((w, i) => (
          <span key={i} className={warnCls}>{w}</span>
        ))}
        {view === "dqdv" && showPeaks && dqdvPeaks && dqdvPeaks.peaks.length === 0 && (
          <span className={chipCls}>no peaks above threshold</span>
        )}
      </div>

      {showInfo && (
        <InfoModal title="GCD — Calculations" onClose={() => setShowInfo(false)}>
          <Calc name="Discharge capacity (mAh)">
            <p>Computed from the chronopotentiometry discharge segment for each cycle:</p>
            <Formula>{"Q_dis = I × t_dis / 3600\n\nI      — applied current (A)\nt_dis  — duration of the discharge step (s)\nResult in mAh."}</Formula>
          </Calc>
          <Calc name="Coulombic Efficiency — CE (%)">
            <p>Ratio of discharge to charge capacity per cycle:</p>
            <Formula>{"CE = Q_dis / Q_chg × 100 %"}</Formula>
          </Calc>
          <Calc name="Fade (%)">
            <p>Percentage capacity loss from the first to the last available cycle:</p>
            <Formula>{"Fade = (Q_dis,1 − Q_dis,N) / Q_dis,1 × 100 %"}</Formula>
          </Calc>
          <Calc name="V–Q profiles (Profiles view)">
            <p>Capacity Q is computed by integrating the measured current over time:</p>
            <Formula>{"Q(t) = ∫|Im(t)| dt   [converted to mAh]\nPlotted as voltage V(t) vs Q(t) per step."}</Formula>
          </Calc>
          <Calc name="dQ/dV (differential capacity)">
            <p>Computed from adjacent data points:</p>
            <Formula>{"dQ = |Im| × dt   (mAh)\ndQ/dV = dQ / (V_{i+1} − V_i)\n\nA box-car moving average is applied to reduce noise."}</Formula>
          </Calc>
          <Calc name="Discharge energy (mWh)">
            <p>Computed from the raw discharge waveform on upload:</p>
            <Formula>{"E = ∫ V(t) × |Im(t)| dt   [J]\nConverted: mWh = E / 3.6"}</Formula>
          </Calc>
          <Calc name="Energy efficiency η (%)">
            <p>Ratio of discharge to charge energy per cycle, shown when both are available in the file:</p>
            <Formula>{"η = E_dis / E_ch × 100 %\nE = ∫ V(t) × |Im(t)| dt per step"}</Formula>
          </Calc>
          <Calc name="IR drop / ESR (Profiles view)">
            <p>Voltage jump at the charge→discharge current reversal, measured 2 points either side of the transition to skip current-settling transients. The two points used are marked on the plot. The current step ΔI is detected from the waveform (median of the last/first 5 current samples of each step):</p>
            <Formula>{"ESR (GCD) = ΔV / |ΔI|\n\nΔV — voltage jump at the reversal (V)\nΔI — detected current step (A)\n\nEquals ΔV/(2·I) only when the current flips exactly from +I to −I."}</Formula>
          </Calc>
          <Calc name="dQ/dV apparent peaks">
            <p>Local extrema of the smoothed |dQ/dV| curve above a user-set prominence threshold (% of the maximum). Labels show the apparent peak voltage in mV. Detection depends on the smoothing window and threshold; warnings appear when peaks are near the noise level or when the smoothing window exceeds the peak width.</p>
          </Calc>
        </InfoModal>
      )}

      {/* Plot area */}
      <div ref={plotRef} className="relative flex-1 min-h-0">
        {waveformError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertTriangle size={24} className="text-amber-400 shrink-0" />
            <p className="text-xs text-forest-400 max-w-xs leading-relaxed">
              Analysis data is unavailable — the server may have restarted.
              Re-upload your <span className="text-forest-300 font-mono">.dta</span> file to restore this view.
            </p>
          </div>
        ) : waveformLoading ? (
          <div className="absolute inset-0 flex flex-col gap-3 p-4 animate-pulse">
            <div className="h-3 bg-forest-700/40 rounded w-3/4" />
            <div className="flex-1 bg-forest-700/20 rounded" />
            <div className="h-3 bg-forest-700/40 rounded w-1/2" />
          </div>
        ) : view === "profiles" && profileQ.data && plotData.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-xs text-panel-muted">No data for selected cycles</p>
          </div>
        ) : view === "dqdv" && showPeaks && dqdvPeaks && dqdvPeaks.peaks.length === 0 ? (
          <div className="absolute inset-0 flex flex-col">
            <div className="absolute inset-0">
              <Plot key={plotKey} data={styledData} layout={finalLayout} onRelayout={onRelayout as never}
                    config={{ responsive: true, displayModeBar: "hover", displaylogo: false, scrollZoom: true, edits: { legendPosition: true } }}
                    style={{ width: "100%", height: "100%" }} useResizeHandler />
            </div>
          </div>
        ) : (
          <div className="absolute inset-0">
            <Plot key={plotKey} data={styledData} layout={finalLayout} onRelayout={onRelayout as never}
                  config={{ responsive: true, displayModeBar: "hover", displaylogo: false, scrollZoom: true, edits: { legendPosition: true } }}
                  style={{ width: "100%", height: "100%" }} useResizeHandler />
          </div>
        )}
      </div>
    </div>
  );
}
