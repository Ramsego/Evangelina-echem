import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Plot from "react-plotly.js";
import { useQuery } from "@tanstack/react-query";
import { analyzeCV, analyzeTafel } from "../../api/client";
import { ParsedFile } from "../../types";
import InfoModal, { Calc, Formula } from "../InfoModal";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useDebounce } from "../../hooks/useDebounce";
import { useZoom } from "../../hooks/useZoom";
import { useStyle, useStyleContext } from "../../context/StyleContext";
import { applyStyleToData, applyStyleToLayout, resolveLegendFontSize } from "../../utils/applyStyle";
import { useExportContext, CollectResult } from "../../context/ExportContext";
import { exportPlotImage, downloadCsv, downloadTxt, buildSummaryTxt, metaComments, SummarySection } from "../../utils/exportUtils";
import { LAYOUT_BASE, axisOverride, parseScanRateMvs, interpolateLinear, shortName, computeExtents } from "../../utils/plotUtils";
import { useZoomClamp } from "../../hooks/useZoomClamp";
import { ELECTRODE_OPTIONS, refOffset, xAxisLabel } from "../../utils/referenceElectrodes";
import { useContainerSize } from "../../hooks/useContainerSize";
import AxisInput from "../AxisInput";
import Tooltip from "../Tooltip";

const COLORS = ["#74C69D","#D4A057","#60a5fa","#f472b6","#a78bfa","#fbbf24","#34d399","#f87171"];

const inputCls = "bg-panel-bg border border-panel-border rounded px-1 py-0.5 text-panel-text focus:outline-none focus:ring-1 focus:ring-forest-400";
const warnCls  = "text-[10px] text-amber-500 bg-amber-400/10 border border-amber-400/40 rounded px-2 py-0.5";
const chipCls  = "text-[10px] text-[color:var(--chip-text)] bg-[color:var(--chip-bg)] rounded px-2 py-0.5";

interface PeakPoint {
  curveIdx: number;
  type: 'ox' | 'red';
  peakIdx: number;
}

interface PeakPair {
  id: string;
  ox: PeakPoint;
  red: PeakPoint;
}

interface Props {
  file: ParsedFile;
  allFiles?: ParsedFile[];
  bgFileId?: string | null;
  capVLo?: string;
  capVHi?: string;
  capKey?: number;
  onFocus?: () => void;
}

export default function CVPanel({ file, allFiles, bgFileId, capVLo = "", capVHi = "", capKey = 0, onFocus }: Props) {
  const style   = useStyle(file.id);
  const isLSV   = file.etype === "LSV";
  const curves  = file.curves ?? [];
  const total   = file.total_curves ?? curves.length;
  const loading = !file.curves && !!file.total_curves;

  // Controls — persisted across sessions
  const detectedRate = parseScanRateMvs(file.metadata?.SCANRATE);
  const [manualScanRate, setManualScanRate] = useLocalStorage(`${file.id}.scanRate`, 10);
  const scanRate = detectedRate ?? manualScanRate;
  const [refFrom,  setRefFrom]  = useLocalStorage(`${file.id}.refFrom`, "As measured");
  const [refTo,    setRefTo]    = useLocalStorage(`${file.id}.refTo`,   "As measured");
  const [pH,       setPH]       = useLocalStorage(`${file.id}.pH`,      7.0);
  const [norm,     setNorm]     = useLocalStorage<"none"|"area"|"mass">(`${file.id}.norm`, "none");
  const [normVal,  setNormVal]  = useLocalStorage(`${file.id}.normVal`, 1.0);
  const [area,     setArea]     = useLocalStorage(`${file.id}.area`, 1.0);
  // Session-only controls
  const [loDraft,  setLo]       = useState(1);
  const [hiDraft,  setHi]       = useState(total);
  const lo = useDebounce(loDraft, 150);
  const hi = useDebounce(hiDraft, 150);
  const [peaks,    setPeaks]    = useState(false);
  const [prom,     setProm]     = useLocalStorage(`${file.id}.peakProm`, 5);
  const [showInfo, setShowInfo] = useState(false);
  const [axesOpen,       setAxesOpen]       = useState(false);
  const [dragmode,       setDragmode]       = useState<'zoom'|'pan'>('zoom');
  const [xMin,           setXMin]           = useState("");
  const [xMax,           setXMax]           = useState("");
  const [yMin,           setYMin]           = useState("");
  const [yMax,           setYMax]           = useState("");
  const [xLog,           setXLog]           = useState(false);
  const [yLog,           setYLog]           = useState(false);
  const [xTitleOverride, setXTitleOverride] = useState("");
  const [yTitleOverride, setYTitleOverride] = useState("");
  // Redox pair selection — transient, depends on live peak query data
  const [selectorMode, setSelectorMode] = useState(false);
  const [pending,      setPending]      = useState<PeakPoint | null>(null);
  const [pairs,        setPairs]        = useState<PeakPair[]>([]);

  const vOffset   = refOffset(refFrom, refTo, pH);
  const imDivisor = norm === "area" ? normVal : norm === "mass" ? normVal / 1000 : 1.0;
  const yLabel    = norm === "area" ? "Current density (mA/cm²)" : norm === "mass" ? "Specific current (mA/g)" : "Current (mA)";
  const xLabel    = xAxisLabel(refTo);

  const indices   = useMemo(
    () => Array.from({ length: hi - lo + 1 }, (_, i) => lo - 1 + i).filter(i => i >= 0 && i < total),
    [lo, hi, total]
  );
  const selCurves = useMemo(() => indices.map(i => curves[i]), [indices, curves]);

  // Background subtraction — sorted by raw voltage for binary-search interpolation.
  // vOffset is intentionally excluded: both main and background share the same reference,
  // so subtracting at the raw (unshifted) voltage is equivalent and avoids a re-sort on every offset change.
  const bgCurve = useMemo(() => {
    if (!bgFileId || !allFiles) return null;
    const bg = allFiles.find(f => f.id === bgFileId);
    if (!bg?.curves?.[0]) return null;
    const c = bg.curves[0];
    const pairs = c.vf.map((v, i) => ({ v, im: c.im[i] }));
    pairs.sort((a, b) => a.v - b.v);
    return { vf: pairs.map(p => p.v), im: pairs.map(p => p.im) };
  }, [bgFileId, allFiles]);

  // CV analysis — auto-fires for peaks; fires for capacitance only when Calculate is clicked
  const cvQ = useQuery({
    queryKey: ["cv", file.id, capKey, capVLo, capVHi, scanRate, vOffset, imDivisor, peaks, prom, lo, hi],
    queryFn:  () => analyzeCV({
      curves:       selCurves,
      scan_rate_mv: scanRate,
      v_offset:     vOffset,
      im_divisor:   imDivisor,
      detect_peaks: peaks,
      prominence:   prom / 100,
      v_lo:         capVLo !== "" ? Number(capVLo) : undefined,
      v_hi:         capVHi !== "" ? Number(capVHi) : undefined,
    }),
    enabled: (capKey > 0 || peaks) && selCurves.length > 0 && !isLSV,
  });

  // Tafel analysis (LSV only) — fit window is user-selectable; blank = auto
  const [tafelVLoDraft, setTafelVLo] = useState("");
  const [tafelVHiDraft, setTafelVHi] = useState("");
  const tafelVLo = useDebounce(tafelVLoDraft, 400);
  const tafelVHi = useDebounce(tafelVHiDraft, 400);
  const tafelQ = useQuery({
    queryKey: ["tafel", file.id, area, vOffset, tafelVLo, tafelVHi],
    queryFn:  () => analyzeTafel({
      curve: { vf: curves[0].vf.map(v => v + vOffset), im: curves[0].im },
      area_cm2: area,
      v_lo: tafelVLo !== "" ? Number(tafelVLo) : undefined,
      v_hi: tafelVHi !== "" ? Number(tafelVHi) : undefined,
    }),
    enabled:  isLSV && curves.length > 0,
  });

  // Build plot data. peakTraceMap maps a Plotly trace index → the peak set it draws,
  // so click events on a star marker can be resolved back to {curveIdx, type}.
  const { plotData, peakTraceMap } = useMemo(() => {
    const data: Plotly.Data[] = [];
    const traceMap = new Map<number, { curveIdx: number; type: 'ox' | 'red' }>();
    if (isLSV && curves.length > 0) {
      const c = curves[0];
      const j = c.im.map(v => (v / imDivisor) * 1000);
      const logJ = j.map(v => Math.log10(Math.abs(v)));
      const valid = j.map((_, i) => Math.abs(j[i]) > 3e-3);
      data.push({
        x: c.vf.filter((_, i) => valid[i]).map(v => v + vOffset),
        y: logJ.filter((_, i) => valid[i]),
        type: "scatter", mode: "lines", name: "log|j|",
        line: { color: COLORS[0], width: 2 },
      });
      if (tafelQ.data?.success) {
        data.push({
          x: tafelQ.data.fit_v,
          y: tafelQ.data.fit_log_j,
          type: "scatter", mode: "lines", name: "Tafel fit",
          line: { color: COLORS[1], width: 2, dash: "dash" },
        });
      }
    } else {
      selCurves.forEach((c, idx) => {
        const vDisp = c.vf.map(v => v + vOffset);
        const y = c.im.map((im, i) => {
          const raw = (im / imDivisor) * 1000;
          if (!bgCurve) return raw;
          const bgIm = interpolateLinear(bgCurve.vf, bgCurve.im, c.vf[i]);
          return raw - (bgIm / imDivisor) * 1000;
        });
        data.push({
          x: vDisp,
          y,
          type: "scatter", mode: "lines",
          name: `Cycle ${indices[idx] + 1}`,
          line: { color: COLORS[idx % COLORS.length], width: 1.8 },
        });
        if (peaks && cvQ.data?.peaks?.[idx]) {
          const pk = cvQ.data.peaks[idx];
          if (pk.oxidation.voltages.length) {
            traceMap.set(data.length, { curveIdx: idx, type: 'ox' });
            data.push({ x: pk.oxidation.voltages, y: pk.oxidation.currents, type: "scatter", mode: "markers", name: "Ox. peak", marker: { color: "#D4A057", size: 10, symbol: "star" }, showlegend: idx === 0 });
          }
          if (pk.reduction.voltages.length) {
            traceMap.set(data.length, { curveIdx: idx, type: 'red' });
            data.push({ x: pk.reduction.voltages, y: pk.reduction.currents, type: "scatter", mode: "markers", name: "Red. peak", marker: { color: "#60a5fa", size: 10, symbol: "star" }, showlegend: idx === 0 });
          }
        }
      });

      // Highlight overlays — drawn on top of the base peak traces. They are appended
      // last so their trace indices fall outside peakTraceMap and never resolve a click.
      if (peaks && cvQ.data?.peaks) {
        const px: number[] = [], py: number[] = [];
        pairs.forEach(pair => {
          ([pair.ox, pair.red] as PeakPoint[]).forEach(pt => {
            const set = cvQ.data!.peaks![pt.curveIdx]?.[pt.type === 'ox' ? 'oxidation' : 'reduction'];
            if (set && pt.peakIdx < set.voltages.length) { px.push(set.voltages[pt.peakIdx]); py.push(set.currents[pt.peakIdx]); }
          });
        });
        if (px.length) {
          data.push({ x: px, y: py, type: "scatter", mode: "markers", name: "Paired", marker: { color: "#52B788", size: 12, symbol: "star" }, showlegend: false, hoverinfo: "skip" });
        }
        if (pending) {
          const set = cvQ.data.peaks[pending.curveIdx]?.[pending.type === 'ox' ? 'oxidation' : 'reduction'];
          if (set && pending.peakIdx < set.voltages.length) {
            data.push({ x: [set.voltages[pending.peakIdx]], y: [set.currents[pending.peakIdx]], type: "scatter", mode: "markers", name: "Pending", marker: { color: "#FFFFFF", size: 14, symbol: "star" }, showlegend: false, hoverinfo: "skip" });
          }
        }
      }
    }
    return { plotData: data, peakTraceMap: traceMap };
  }, [isLSV, curves, selCurves, indices, vOffset, imDivisor, peaks, cvQ.data, tafelQ.data, bgCurve, pending, pairs]);

  // Keep the trace→peak map reachable from the (non-memoized) click handler.
  const peakTraceMapRef = useRef(peakTraceMap);
  peakTraceMapRef.current = peakTraceMap;

  // Seed an editable pairing suggestion when fresh peak data arrives: match each
  // oxidation peak (dominant first) to its nearest unmatched reduction peak.
  useEffect(() => {
    if (!peaks || !cvQ.data?.peaks) { setPairs([]); return; }
    const next: PeakPair[] = [];
    cvQ.data.peaks.forEach((pk, curveIdx) => {
      const nOx = pk.oxidation.voltages.length;
      const nRed = pk.reduction.voltages.length;
      if (!nOx || !nRed) return;
      const oxOrder = [...Array(nOx).keys()].sort(
        (a, b) => Math.abs(pk.oxidation.currents_corrected[b]) - Math.abs(pk.oxidation.currents_corrected[a])
      );
      const matched = new Set<number>();
      for (const oxIdx of oxOrder) {
        let best = -1, bestDist = Infinity;
        for (let ri = 0; ri < nRed; ri++) {
          if (matched.has(ri)) continue;
          const d = Math.abs(pk.oxidation.voltages[oxIdx] - pk.reduction.voltages[ri]);
          if (d < bestDist) { bestDist = d; best = ri; }
        }
        if (best >= 0) {
          matched.add(best);
          next.push({ id: `auto-${curveIdx}-${oxIdx}-${best}`, ox: { curveIdx, type: 'ox', peakIdx: oxIdx }, red: { curveIdx, type: 'red', peakIdx: best } });
        }
      }
    });
    setPairs(next);
  }, [cvQ.dataUpdatedAt, peaks]); // eslint-disable-line react-hooks/exhaustive-deps -- dataUpdatedAt is the stable signal for "new peaks arrived"

  function handlePlotClick(event: Plotly.PlotMouseEvent) {
    if (!selectorMode || !event.points.length) return;
    const pt = event.points[0];
    const info = peakTraceMapRef.current.get(pt.curveNumber);
    if (!info) return; // clicked the CV line or a highlight overlay — ignore
    const clicked: PeakPoint = { curveIdx: info.curveIdx, type: info.type, peakIdx: pt.pointIndex };
    if (!pending || pending.type === clicked.type) { setPending(clicked); return; }
    const ox  = pending.type === 'ox' ? pending : clicked;
    const red = pending.type === 'red' ? pending : clicked;
    setPairs(ps => [
      ...ps.filter(p =>
        !(p.ox.curveIdx === ox.curveIdx && p.ox.peakIdx === ox.peakIdx) &&
        !(p.red.curveIdx === red.curveIdx && p.red.peakIdx === red.peakIdx)
      ),
      { id: `pair-${Date.now()}`, ox, red },
    ]);
    setPending(null);
  }

  useEffect(() => {
    if (!selectorMode) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setPending(null); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectorMode]);

  const uiRevKey = `${file.id}-${lo}-${hi}-${norm}-${refFrom}-${refTo}`;
  const { onRelayout: zoomOnRelayout, legendState, hasZoom, getRangeSnapshot } = useZoom(uiRevKey);
  const [plotRef, plotSize] = useContainerSize();
  const { setLegendAutoSize } = useStyleContext();

  const rawLayout = useMemo((): Partial<Plotly.Layout> => ({
    ...LAYOUT_BASE,
    xaxis: { ...LAYOUT_BASE.xaxis, title: { text: xTitleOverride || xLabel, font: { color: "#74C69D" } }, ...axisOverride(xMin, xMax, xLog) },
    yaxis: { ...LAYOUT_BASE.yaxis, title: { text: yTitleOverride || (isLSV ? "log₁₀ |j| (mA/cm²)" : yLabel), font: { color: "#74C69D" } }, ...axisOverride(yMin, yMax, yLog) },
    // Shaded band shows exactly which points entered the Tafel regression
    ...(isLSV && tafelQ.data?.success ? {
      shapes: [{
        type: "rect" as const, xref: "x" as const, yref: "paper" as const,
        x0: tafelQ.data.v_lo, x1: tafelQ.data.v_hi, y0: 0, y1: 1,
        fillcolor: "rgba(82,183,136,0.12)", line: { width: 0 },
      }],
    } : {}),
  }), [xTitleOverride, xLabel, xMin, xMax, xLog, yTitleOverride, isLSV, yLabel, yMin, yMax, yLog, tafelQ.data]);
  const styledData   = useMemo(() => applyStyleToData(plotData, style),   [plotData, style]);
  const extents = useMemo(() => { const e = computeExtents(styledData); return e ? { ...e, xIsLog: xLog, yIsLog: yLog } : null; }, [styledData, xLog, yLog]);
  const { onRelayout, clamp, uirevision, plotKey } = useZoomClamp(extents, zoomOnRelayout, uiRevKey);
  const styledLayout = useMemo(() => applyStyleToLayout(rawLayout, style), [rawLayout, style]);
  const legendFontSize = resolveLegendFontSize(style, plotSize);
  useEffect(() => { setLegendAutoSize(file.id, legendFontSize); }, [file.id, legendFontSize, setLegendAutoSize]);
  const layout = useMemo((): Partial<Plotly.Layout> => ({
    ...styledLayout,
    uirevision,
    dragmode: selectorMode ? (false as unknown as 'zoom') : dragmode,
    legend: {
      ...(styledLayout.legend as object ?? {}),
      font: { ...(((styledLayout.legend as { font?: object } | undefined)?.font) ?? {}), size: legendFontSize },
      ...(legendState.x != null ? { x: legendState.x, y: legendState.y } : {}),
    },
    ...(clamp.x && { xaxis: { ...(styledLayout.xaxis ?? {}), autorange: false as const, range: clamp.x } }),
    ...(clamp.y && { yaxis: { ...(styledLayout.yaxis ?? {}), autorange: false as const, range: clamp.y } }),
  }), [styledLayout, uirevision, dragmode, selectorMode, legendFontSize, legendState, clamp]);

  // Only show capacitance results when the user has explicitly triggered a calculation
  const caps  = capKey > 0 ? cvQ.data?.capacitances_mf : undefined;
  const tafel = tafelQ.data;

  // ── Export ───────────────────────────────────────────────────────────────
  const { register, unregister } = useExportContext();

  const buildCsv = useCallback((): string => {
    const meta: string[] = [
      ...metaComments(file.metadata),
      ...(norm !== "none" ? [`# Normalised by ${norm === "area" ? `area: ${normVal} cm2` : `mass: ${normVal} mg`}`] : []),
      ...(vOffset !== 0 ? [`# Reference: ${refFrom} → ${refTo}  (offset ${vOffset >= 0 ? "+" : ""}${vOffset.toFixed(3)} V)`] : []),
      ...(caps ? [`# Capacitance (${capVLo || "full range"} – ${capVHi || "full range"} V): ${caps.map((c: number, i: number) => `C${indices[i] + 1}=${c.toFixed(2)} mF`).join("  ")}`] : []),
    ];

    const headers: string[] = [];
    const units:   string[] = [];
    selCurves.forEach((_, idx) => {
      const n = indices[idx] + 1;
      headers.push(`Pot_${n}`, `Cur_${n}`);
      units.push("V", "mA");
      if (norm !== "none") {
        headers.push(norm === "area" ? `CurDens_${n}` : `SpecCur_${n}`);
        units.push(norm === "area" ? "mA/cm2" : "mA/g");
      }
    });

    const maxLen = Math.max(...selCurves.map(c => c.vf.length));
    const dataRows: string[] = [];
    for (let r = 0; r < maxLen; r++) {
      const row: string[] = [];
      selCurves.forEach((c, idx) => {
        row.push(
          c.vf[r] !== undefined ? (c.vf[r] + vOffset).toFixed(6) : "",
          c.im[r] !== undefined ? (c.im[r] * 1000).toFixed(6)    : "",
        );
        if (norm !== "none") {
          row.push(c.im[r] !== undefined ? ((c.im[r] / imDivisor) * 1000).toFixed(6) : "");
        }
        void idx;
      });
      dataRows.push(row.join(","));
    }
    return [...meta, headers.join(","), units.join(","), ...dataRows].join("\n");
  }, [selCurves, indices, vOffset, imDivisor, norm, normVal, caps, capVLo, capVHi, file.metadata]);

  const buildTxt = useCallback((): string => {
    const sections: SummarySection[] = [];
    const values: string[] = [
      `Scan rate: ${scanRate} mV/s${detectedRate != null ? " (from file metadata)" : " (user-entered)"}`,
      ...(vOffset !== 0 ? [`Reference conversion: ${refFrom} → ${refTo} (offset ${vOffset >= 0 ? "+" : ""}${vOffset.toFixed(3)} V)`] : []),
      ...(norm !== "none" ? [`Normalisation: by ${norm} (${normVal} ${norm === "area" ? "cm²" : "mg"})`] : []),
    ];
    const warnings: string[] = [];
    const definitions: string[] = [];

    if (!isLSV && peaks && pairs.length > 0 && cvQ.data?.peaks) {
      const pkData = cvQ.data.peaks;
      values.push("", `Redox pairs (user-assigned, prominence threshold ${prom}% of current range):`);
      pairs.forEach((pair, i) => {
        const oxSet  = pkData[pair.ox.curveIdx]?.oxidation;
        const redSet = pkData[pair.red.curveIdx]?.reduction;
        if (!oxSet || !redSet || pair.ox.peakIdx >= oxSet.voltages.length || pair.red.peakIdx >= redSet.voltages.length) return;
        const vOx  = oxSet.voltages[pair.ox.peakIdx];
        const vRed = redSet.voltages[pair.red.peakIdx];
        const iRed = redSet.currents_corrected[pair.red.peakIdx];
        const iOx  = oxSet.currents_corrected[pair.ox.peakIdx];
        const dE   = (vOx - vRed) * 1000;
        const eH   = (vOx + vRed) / 2;
        values.push(
          `  Pair ${i + 1}: E_pa=${vOx.toFixed(3)} V  E_pc=${vRed.toFixed(3)} V  ` +
          `ΔE_p=${dE.toFixed(0)} mV  E½=${eH.toFixed(3)} V` +
          (iRed !== 0 ? `  |i_pa/i_pc|=${Math.abs(iOx / iRed).toFixed(2)}` : "")
        );
      });
      definitions.push(
        "E_pa / E_pc: Potentials of the anodic and cathodic peaks in each assigned pair.",
        "ΔE_p: E_pa − E_pc.",
        "E½: (E_pa + E_pc) / 2.",
        "|i_pa/i_pc|: Ratio of anodic to cathodic peak current magnitudes after baseline",
        "  correction (a line fitted to the pre-peak region is extrapolated under the peak).",
        "Pairs are assigned automatically by peak proximity and can be edited in the panel.",
      );
    }
    if (!isLSV && caps && caps.length > 0) {
      values.push("", `Capacitance [∮|i|dV / (2·ν·ΔV)] over ${capVLo || "full"}–${capVHi || "full"} V:`);
      caps.forEach((c: number, i: number) => values.push(`  Cycle ${indices[i] + 1}: ${c.toFixed(2)} mF`));
      definitions.push(
        "Capacitance: Integrated CV loop area normalised by scan rate and window width.",
        "  Not normalised by electrode area or mass unless stated above.",
      );
    }
    if (isLSV && tafel) {
      if (tafel.success) {
        values.push(
          `Apparent Tafel slope: ${tafel.slope_mv_dec.toFixed(1)} ± ${tafel.slope_err_mv_dec.toFixed(1)} mV/dec  [linear fit of log₁₀|j| vs E; ± = 1σ standard error]`,
          `j₀: ${tafel.j0_mA_cm2.toExponential(3)} mA/cm²  [10^intercept at E = 0]`,
          `R²: ${tafel.r2.toFixed(4)}`,
          `Fit window: ${tafel.v_lo.toFixed(3)} to ${tafel.v_hi.toFixed(3)} V (${tafel.n_points} points, ${tafel.auto_window ? "auto-selected" : "user-selected"})`,
          `Electrode area: ${area} cm²`,
        );
        if (tafel.auto_window) warnings.push("Tafel window was auto-selected (not user-verified)");
        if (tafel.r2 < 0.98)   warnings.push("Poor linear fit in selected Tafel window (R² < 0.98)");
        definitions.push(
          "Apparent Tafel slope: Slope of the linear regression of log₁₀|j| vs E within the",
          "  stated window. Reported as-is; not converted to α or n.",
          "j₀: Current density extrapolated from the fit intercept to E = 0.",
        );
      } else {
        warnings.push("Tafel fit failed — fewer than 5 valid points in the selected window");
      }
    }

    sections.push({ title: "Computed values", lines: values });
    sections.push({ title: "Warnings", lines: warnings.length ? warnings : ["(none)"] });
    sections.push({ title: "Definitions", lines: definitions });
    return buildSummaryTxt(
      file.name, isLSV ? "LSV" : "CV", sections,
      `"I have ${isLSV ? "linear sweep voltammetry" : "cyclic voltammetry"} data from [describe your system: electrode, electrolyte,\nreference electrode, temperature]. The computed parameters and their formulas are above.\nPlease help me interpret these values, list possible explanations for any anomalies, and\nsuggest follow-up experiments to distinguish between them."`,
    );
  }, [file.name, isLSV, scanRate, detectedRate, vOffset, refFrom, refTo, norm, normVal, peaks, prom, pairs, cvQ.data, indices, caps, capVLo, capVHi, tafel, area]);

  const handleExportRef = useRef<(fmt: string) => void>(() => {});
  const collectRef = useRef<() => CollectResult>(() => ({ filename: '', csv: '', plotData: [], layout: {} }));

  handleExportRef.current = (fmt: string) => {
    if (fmt === "csv") { downloadCsv(buildCsv(), file.name); return; }
    if (fmt === "txt") { downloadTxt(buildTxt(), file.name); return; }
    exportPlotImage(styledData, layout, file.name, fmt as "png" | "svg");
  };
  collectRef.current = () => ({
    filename: file.name.replace(/\.dta$/i, ''),
    csv: buildCsv(),
    txt: buildTxt(),
    plotData: styledData,
    layout,
  });

  useEffect(() => {
    register(file.id, fmt => handleExportRef.current(fmt), () => collectRef.current());
    return () => unregister(file.id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- register/unregister are stable (backed by useRef in ExportProvider); mount-only registration is intentional

  return (
    <div className="h-full flex flex-col" onClick={onFocus}>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 bg-panel-header border-b border-panel-border text-xs text-panel-text shrink-0">
        {!isLSV && (
          <>
            <label className="flex items-center gap-1">
              Curves
              <input type="number" value={loDraft} min={1} max={hiDraft}
                     onChange={e => setLo(Number(e.target.value))}
                     className={`w-10 ${inputCls} ml-1`} />
              –
              <input type="number" value={hiDraft} min={loDraft} max={total}
                     onChange={e => setHi(Number(e.target.value))}
                     className={`w-10 ${inputCls}`} />
            </label>
            {detectedRate != null ? (
              <span className="flex items-center gap-1 text-[10px] text-panel-muted">
                Scan rate
                <span className="ml-1 px-1.5 py-0.5 bg-panel-bg rounded text-panel-text">{detectedRate} mV/s</span>
              </span>
            ) : (
              <label className="flex items-center gap-1">
                Scan rate
                <input type="number" value={manualScanRate} min={1}
                       onChange={e => setManualScanRate(Number(e.target.value))}
                       className={`w-14 ${inputCls} ml-1`} />
                mV/s
              </label>
            )}
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={peaks}
                     onChange={e => { setPeaks(e.target.checked); if (!e.target.checked) { setPairs([]); setPending(null); setSelectorMode(false); } }}
                     className="accent-forest-400" />
              Peaks
            </label>
            {peaks && (
              <label className="flex items-center gap-1">
                <Tooltip content="Peak prominence — minimum peak height relative to surroundings" side="bottom">
                  <span>Threshold</span>
                </Tooltip>
                <input type="number" value={prom} min={1} max={20}
                       onChange={e => setProm(Number(e.target.value))}
                       className={`w-10 ${inputCls} ml-1`} />
                %
              </label>
            )}
          </>
        )}

        {/* Reference electrode conversion */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-panel-muted shrink-0">Ref</span>
          <select value={refFrom} onChange={e => setRefFrom(e.target.value)} className={`${inputCls} text-[10px]`}>
            {ELECTRODE_OPTIONS.map(k => <option key={k}>{k}</option>)}
          </select>
          <span className="text-panel-muted shrink-0">→</span>
          <select value={refTo} onChange={e => setRefTo(e.target.value)} className={`${inputCls} text-[10px]`}>
            {ELECTRODE_OPTIONS.map(k => <option key={k}>{k}</option>)}
          </select>
          {(refFrom === "RHE" || refTo === "RHE") && (
            <label className="flex items-center gap-1">
              <span className="text-[10px] text-panel-muted">pH</span>
              <input type="number" value={pH} min={0} max={14} step={0.5}
                     onChange={e => setPH(Number(e.target.value))}
                     className={`w-10 ${inputCls}`} />
            </label>
          )}
          {vOffset !== 0 && (
            <span className="text-[9px] text-panel-muted shrink-0">
              ({vOffset > 0 ? "+" : ""}{vOffset.toFixed(3)} V)
            </span>
          )}
        </div>

        <select value={norm} onChange={e => setNorm(e.target.value as "none"|"area"|"mass")} className={inputCls}>
          <option value="none">No normalisation</option>
          <option value="area">By area (cm²)</option>
          <option value="mass">By mass (mg)</option>
        </select>
        {norm !== "none" && (
          <input type="number" value={normVal} min={0.001} step={0.01}
                 onChange={e => setNormVal(Number(e.target.value))}
                 className={`w-16 ${inputCls}`} />
        )}
        {isLSV && (
          <>
            <label className="flex items-center gap-1">
              Area
              <input type="number" value={area} min={0.001} step={0.01}
                     onChange={e => setArea(Number(e.target.value))}
                     className={`w-14 ${inputCls} ml-1`} />
              cm²
            </label>
            <label className="flex items-center gap-1" title="Tafel fit window — leave blank for auto-selection">
              Fit V
              <input type="number" value={tafelVLoDraft} step={0.01}
                     placeholder={tafelVLoDraft === "" && tafelQ.data ? tafelQ.data.v_lo?.toFixed(3) ?? "auto" : "auto"}
                     onChange={e => setTafelVLo(e.target.value)}
                     className={`w-16 ${inputCls} ml-1`} />
              –
              <input type="number" value={tafelVHiDraft} step={0.01}
                     placeholder={tafelVHiDraft === "" && tafelQ.data ? tafelQ.data.v_hi?.toFixed(3) ?? "auto" : "auto"}
                     onChange={e => setTafelVHi(e.target.value)}
                     className={`w-16 ${inputCls}`} />
            </label>
          </>
        )}


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

        {peaks && (
          <button
            onClick={() => { setSelectorMode(m => !m); setPending(null); }}
            title="Assign redox pairs by clicking peak markers"
            className={`px-2 py-0.5 text-[10px] rounded border transition-colors shrink-0 ${selectorMode ? "bg-forest-600 text-white border-forest-500" : "border-panel-border text-panel-muted hover:text-panel-text"}`}>
            Pairs ✎
          </button>
        )}

        <button onClick={() => setAxesOpen(o => !o)}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${axesOpen ? "bg-forest-600 border-forest-600 text-white" : "border-panel-border text-panel-muted hover:text-panel-text"}`}>
          Axes {axesOpen ? "▴" : "▾"}
        </button>

        <Tooltip content="Show formulas and definitions" side="bottom" className="ml-auto">
          <button onClick={() => setShowInfo(true)}
                  className="text-[10px] text-panel-muted hover:text-panel-text border border-panel-border rounded-full w-4 h-4 flex items-center justify-center transition-colors shrink-0">
            ?
          </button>
        </Tooltip>

        {/* Axes inputs */}
        {axesOpen && (
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
              <input type="text" placeholder={xLabel} value={xTitleOverride} onChange={e => setXTitleOverride(e.target.value)}
                     className={`flex-1 min-w-0 ${inputCls} text-[10px]`} />
              <span className="text-[10px] font-semibold text-panel-muted shrink-0">Y label</span>
              <input type="text" placeholder={isLSV ? "log₁₀ |j| (mA/cm²)" : yLabel} value={yTitleOverride} onChange={e => setYTitleOverride(e.target.value)}
                     className={`flex-1 min-w-0 ${inputCls} text-[10px]`} />
            </div>
          </div>
        )}
      </div>

      {/* Status line */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-0.5 bg-forest-900/50 border-b border-forest-700/20 shrink-0 text-[10px] text-panel-muted">
        <span>{scanRate} mV/s · cycles {lo}–{Math.min(hi, total)} of {total}</span>
        {isLSV && tafel?.success && (
          <>
            <span className={chipCls}>
              slope {tafel.slope_mv_dec.toFixed(1)} ± {tafel.slope_err_mv_dec.toFixed(1)} mV/dec
            </span>
            <span className={chipCls}>R² {tafel.r2.toFixed(4)}</span>
            {tafel.auto_window && (
              <span className={chipCls}>auto window {tafel.v_lo.toFixed(2)}–{tafel.v_hi.toFixed(2)} V</span>
            )}
          </>
        )}
        {isLSV && tafel && !tafel.success && tafel.v_lo != null && tafel.v_hi != null && (
          <span className="text-[10px] text-amber-500 bg-amber-400/10 border border-amber-400/40 rounded px-2 py-0.5">
            Tafel fit failed — fewer than 5 valid points in window {tafel.v_lo.toFixed(3)}–{tafel.v_hi.toFixed(3)} V; adjust Fit V
          </span>
        )}
        {isLSV && tafelQ.isError && (
          <span className="text-[10px] text-amber-500 bg-amber-400/10 border border-amber-400/40 rounded px-2 py-0.5">
            Tafel request failed
          </span>
        )}
        {cvQ.isError && (
          <span className="text-[10px] text-amber-500 bg-amber-400/10 border border-amber-400/40 rounded px-2 py-0.5">
            peak/capacitance analysis failed
          </span>
        )}
        {!isLSV && selectorMode && pending && (
          <span className="text-forest-500 animate-pulse">
            click a {pending.type === 'ox' ? 'reduction' : 'oxidation'} peak — Esc to cancel
          </span>
        )}
        {!isLSV && cvQ.data?.peaks && pairs.map((pair, i) => {
          const oxSet  = cvQ.data!.peaks![pair.ox.curveIdx]?.oxidation;
          const redSet = cvQ.data!.peaks![pair.red.curveIdx]?.reduction;
          if (!oxSet || !redSet || pair.ox.peakIdx >= oxSet.voltages.length || pair.red.peakIdx >= redSet.voltages.length) return null;
          const vOx  = oxSet.voltages[pair.ox.peakIdx];
          const vRed = redSet.voltages[pair.red.peakIdx];
          const iRed = redSet.currents_corrected[pair.red.peakIdx];
          const iOx  = oxSet.currents_corrected[pair.ox.peakIdx];
          return (
            <span key={pair.id} className={`${chipCls} flex items-center gap-1`}>
              {pairs.length > 1 && <span className="text-forest-500">P{i + 1}</span>}
              ΔE {((vOx - vRed) * 1000).toFixed(0)} mV · E½ {((vOx + vRed) / 2).toFixed(3)} V
              {iRed !== 0 && ` · ${Math.abs(iOx / iRed).toFixed(2)}`}
              <button onClick={() => setPairs(ps => ps.filter(p => p.id !== pair.id))}
                      className="text-forest-500 hover:text-red-400 leading-none cursor-pointer">✕</button>
            </span>
          );
        })}
      </div>

      {showInfo && (
        <InfoModal title={isLSV ? "LSV / Tafel — Calculations" : "CV — Calculations"} onClose={() => setShowInfo(false)}>
          <Calc name="Reference electrode conversion">
            <p>Select the electrode used during measurement (<em>From</em>) and the scale you want to display (<em>To</em>). The app adds a fixed offset so every potential point is re-expressed on the target scale:</p>
            <Formula>{"E_display = E_measured + E_from_vs_SHE − E_to_vs_SHE\n\nE_X_vs_SHE — standard potential of electrode X vs SHE (V)"}</Formula>
            <div className="mt-2 font-mono text-[11px] text-forest-300 leading-5">
              <div>NHE / SHE              0.000 V</div>
              <div>SCE (sat. KCl)        +0.241 V</div>
              <div>Ag/AgCl (3M KCl)      +0.209 V</div>
              <div>Ag/AgCl (sat. KCl)    +0.197 V</div>
              <div>Hg/HgO (1M NaOH)      +0.098 V</div>
              <div>Hg/Hg₂SO₄ (sat.)      +0.615 V</div>
              <div>RHE                   +0.0592×pH V</div>
            </div>
            <p className="text-forest-500 mt-2">RHE requires a pH value — an input appears automatically when RHE is selected. The net offset applied is shown in parentheses in the control bar.</p>
          </Calc>
          {!isLSV && (
            <Calc name="Capacitance Cᵢ (mF)">
              <p>Calculated on demand over the potential window you specify. Enter the V range in the dashboard toolbar and press <em>Calculate</em>:</p>
              <Formula>{"C = ∮ I dV / (2 × ΔV × ν)\n\n∮ I dV  — loop area over [V_lo, V_hi] via trapezoidal rule (A·V)\nΔV      — window width = V_hi − V_lo  (V)\nν       — scan rate (V/s)\nResult in mF."}</Formula>
              <p className="text-forest-500">Leave both inputs blank to use the full potential range of each cycle.</p>
            </Calc>
          )}
          {!isLSV && (
            <Calc name="Peak detection (E_pa, E_pc, ΔE_p, E½, i_pa/i_pc)">
              <p>The CV is split into anodic and cathodic half-sweeps; oxidation peaks are searched only on the anodic sweep and reduction peaks only on the cathodic sweep. Peaks within 2 % of the scan-reversal vertices are discarded as turnaround artifacts.</p>
              <p>Peak currents are baseline-corrected: a line is fit to the pre-peak (capacitive) region and extrapolated under the peak, so i_p measures only the faradaic contribution.</p>
              <Formula>{"ΔE_p = E_pa − E_pc\nE½   = (E_pa + E_pc) / 2\n|i_pa/i_pc| — ratio of baseline-corrected peak current magnitudes"}</Formula>
            </Calc>
          )}
          {isLSV && (
            <>
              <Calc name="Apparent Tafel slope (mV/dec)">
                <p>A linear fit of log₁₀|j| vs E within the fit window. Set the window with the <em>Fit V</em> inputs; if left blank, the middle 60 % of the potential range is used and a warning is shown — the auto window may include near-equilibrium or transport-limited regions. The shaded band on the plot marks exactly which points entered the regression.</p>
                <Formula>{"log₁₀|j| = E / b + log₁₀|j₀|\n\nb   — apparent Tafel slope (mV per decade)\nj₀  — apparent exchange current density (mA/cm²)\n\nOnly points with |j| > 0 in the window are included.\nThe slope is reported as-is and is not converted to α or n."}</Formula>
                <p>The ± uncertainty is the 1σ standard error of the regression slope, propagated to mV/dec. It reflects scatter within the fit window, not systematic window-choice effects.</p>
              </Calc>
              <Calc name="Exchange current density j₀ (mA/cm²)">
                <p>Obtained from the y-intercept of the Tafel fit:</p>
                <Formula>{"j₀ = 10^(intercept)"}</Formula>
              </Calc>
              <Calc name="R² (coefficient of determination)">
                <p>Goodness-of-fit of the linear regression in the Tafel region. Values close to 1 indicate a well-defined linear Tafel slope.</p>
                <Formula>{"R² = 1 − SS_res / SS_tot"}</Formula>
              </Calc>
            </>
          )}
        </InfoModal>
      )}

      {/* Plot */}
      <div ref={plotRef} className="relative flex-1 min-h-0">
        {loading ? (
          <div className="absolute inset-0 flex flex-col gap-3 p-4 animate-pulse">
            <div className="h-3 bg-forest-700/40 rounded w-3/4" />
            <div className="flex-1 bg-forest-700/20 rounded" />
            <div className="h-3 bg-forest-700/40 rounded w-1/2" />
          </div>
        ) : curves.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-xs text-panel-muted">No curves in file</p>
          </div>
        ) : (
          <div className="absolute inset-0">
            <Plot key={plotKey} data={styledData} layout={layout} onRelayout={onRelayout as never}
                  onClick={handlePlotClick as never}
                  config={{ responsive: true, displayModeBar: "hover", displaylogo: false, scrollZoom: true, edits: { legendPosition: true } }}
                  style={{ width: "100%", height: "100%" }} useResizeHandler />
          </div>
        )}
      </div>
    </div>
  );
}
