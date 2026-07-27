import type { CollectResult } from "../context/ExportContext";
import { APP_NAME } from "../constants";

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ── Image export ─────────────────────────────────────────────────────────────

async function getPlotly() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const P = (await import("plotly.js")) as any;
  return P.default ?? P;
}

export type ExportShape = "wide" | "square";

// LAYOUT_BASE default margins; kept in sync with utils/plotUtils.ts.
const DEFAULT_MARGIN = { l: 56, r: 16, t: 10, b: 48 };
// Side of the square plotting box (excluding margins), for "square" exports.
const SQUARE_BOX = 900;

/**
 * Export dimensions for the figure. "wide" keeps the classic 1200×900 (4:3).
 * "square" sizes the image so the *framed data box* is exactly square — what
 * publications mean by a square plot — by adding the layout's margins around a
 * fixed square box, independent of axis-label widths.
 */
function exportDims(shape: ExportShape, layout: Partial<Plotly.Layout>): { width: number; height: number } {
  if (shape !== "square") return { width: 1200, height: 900 };
  const m = (layout.margin ?? {}) as { l?: number; r?: number; t?: number; b?: number };
  const l = m.l ?? DEFAULT_MARGIN.l, r = m.r ?? DEFAULT_MARGIN.r;
  const t = m.t ?? DEFAULT_MARGIN.t, b = m.b ?? DEFAULT_MARGIN.b;
  return { width: SQUARE_BOX + l + r, height: SQUARE_BOX + t + b };
}

/** Render plot offscreen and return a data-URL string (PNG base64 or SVG). */
export async function exportPlotImageData(
  data: Plotly.Data[],
  layout: Partial<Plotly.Layout>,
  format: "png" | "svg",
  shape: ExportShape = "wide",
): Promise<string> {
  const Plotly = await getPlotly();
  const { width, height } = exportDims(shape, layout);
  const div = document.createElement("div");
  div.style.cssText =
    `position:fixed;top:-9999px;left:-9999px;width:${width}px;height:${height}px;visibility:hidden;`;
  document.body.appendChild(div);
  try {
    const exportLayout = {
      ...layout,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor:  "rgba(0,0,0,0)",
      width, height,
    };
    const plotDiv = await Plotly.newPlot(div, data, exportLayout, { staticPlot: true });
    return await Plotly.toImage(plotDiv, { format, width, height });
  } finally {
    try { Plotly.purge(div); } catch { /* ignore */ }
    document.body.removeChild(div);
  }
}

/** Render offscreen and trigger a direct browser download. */
export async function exportPlotImage(
  data: Plotly.Data[],
  layout: Partial<Plotly.Layout>,
  filename: string,
  format: "png" | "svg",
  shape: ExportShape = "wide",
): Promise<void> {
  const Plotly = await getPlotly();
  const { width, height } = exportDims(shape, layout);
  const div = document.createElement("div");
  div.style.cssText =
    `position:fixed;top:-9999px;left:-9999px;width:${width}px;height:${height}px;visibility:hidden;`;
  document.body.appendChild(div);
  try {
    const exportLayout = {
      ...layout,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor:  "rgba(0,0,0,0)",
      width, height,
    };
    const plotDiv = await Plotly.newPlot(div, data, exportLayout, { staticPlot: true });
    await Plotly.downloadImage(plotDiv, {
      format,
      filename: sanitize(filename),
      width, height,
    });
  } finally {
    try { Plotly.purge(div); } catch { /* ignore */ }
    document.body.removeChild(div);
  }
}

// ── CSV download ──────────────────────────────────────────────────────────────

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = sanitize(filename) + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── TXT download ──────────────────────────────────────────────────────────────

export function downloadTxt(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = sanitize(filename) + "_summary.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── LLM-ready analysis summary ────────────────────────────────────────────────

export interface SummarySection {
  title: string;
  lines: string[];
}

/** A panel's LLM-ready content, built once and reused for both the single-panel
 *  and combined exports. */
export interface PanelSummary {
  etypeLabel:       string;
  sections:         SummarySection[];
  llmInstructions:  string;
}

const MAX_TABLE_ROWS = 80;

/** Evenly sample a formatted CSV-row array down to maxRows, always keeping the last row. */
export function decimateRows(rows: string[], maxRows: number = MAX_TABLE_ROWS): { rows: string[]; note: string } {
  if (rows.length <= maxRows) return { rows, note: `${rows.length} points` };
  const stride = Math.ceil(rows.length / maxRows);
  const picked: string[] = [];
  for (let i = 0; i < rows.length; i += stride) picked.push(rows[i]);
  const last = rows[rows.length - 1];
  if (picked[picked.length - 1] !== last) picked.push(last);
  return { rows: picked, note: `${picked.length} of ${rows.length} points, every ${stride}` };
}

/**
 * Plain-text summary of computed values, formulas, data regions, warnings and
 * neutral parameter definitions — structured for pasting into an LLM.
 * Contains no interpretation.
 */
export function buildSummaryTxt(
  fileName:        string,
  etypeLabel:      string,
  sections:        SummarySection[],
  llmInstructions: string,
): string {
  const out: string[] = [
    `${APP_NAME} — Analysis Summary`,
    "================================",
    `File: ${fileName}  |  Type: ${etypeLabel}  |  Exported: ${new Date().toISOString().slice(0, 10)}`,
    "",
  ];
  for (const sec of sections) {
    if (sec.lines.length === 0) continue;
    out.push(`--- ${sec.title} ---`, "", ...sec.lines, "");
  }
  out.push("--- LLM Instructions ---", "", llmInstructions, "");
  return out.join("\n");
}

/**
 * One combined LLM-ready document spanning every summarized entry (e.g. all
 * open panels), with one holistic instruction block instead of a per-technique one.
 * Entries without a summary are skipped.
 */
export function buildCombinedSummaryTxt(
  entries: Array<Pick<CollectResult, "filename" | "summary">>,
): string | null {
  const summarized = entries.filter(
    (e): e is { filename: string; summary: PanelSummary } => e.summary != null,
  );
  if (summarized.length === 0) return null;

  const techniques = [...new Set(summarized.map(e => e.summary.etypeLabel))];
  const out: string[] = [
    `${APP_NAME} — Combined Analysis Summary`,
    "================================",
    `Files: ${summarized.length}  |  Techniques: ${techniques.join(", ")}  |  Exported: ${new Date().toISOString().slice(0, 10)}`,
    "",
  ];
  for (const { filename, summary } of summarized) {
    out.push(`=== ${filename} — ${summary.etypeLabel} ===`, "");
    for (const sec of summary.sections) {
      if (sec.lines.length === 0) continue;
      out.push(`--- ${sec.title} ---`, "", ...sec.lines, "");
    }
  }
  out.push(
    "--- LLM Instructions ---", "",
    `Do not make assumptions about the experimental setup. These files are measurements of\nthe same material/system using different techniques (${techniques.join(", ")}). First ask\nthe user for any missing information that could materially affect interpretation\n(material/system, electrode, electrolyte, cell setup, temperature, experimental\nobjective). Once sufficient context has been provided, interpret the results across all\ntechniques together, note where they agree or disagree, explain any uncertainty, list\npossible explanations for anomalies, and suggest follow-up experiments to distinguish\nbetween them.`,
    "",
  );
  return out.join("\n");
}

// ── ZIP export (multiple formats) ─────────────────────────────────────────────

/**
 * Build and download a ZIP containing one or more formats for one or more panels.
 * Used when ≥ 2 formats are selected.
 */
export async function buildZip(
  entries: CollectResult[],
  fmts:    Array<"png" | "svg" | "csv">,
  zipName: string,
  shape:   ExportShape = "wide",
): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip   = new JSZip();

  await Promise.all(
    entries.map(async ({ filename, csv, plotData, layout, extraPlots }) => {
      const base = sanitize(filename);
      for (const fmt of fmts) {
        if (fmt === "csv") {
          zip.file(`${base}.csv`, csv);
        } else {
          const dataUrl = await exportPlotImageData(plotData, layout, fmt, shape);
          if (fmt === "svg") {
            const svgText = decodeURIComponent(dataUrl.split(",")[1] ?? dataUrl);
            zip.file(`${base}.svg`, svgText);
          } else {
            const b64 = dataUrl.split(",")[1] ?? "";
            zip.file(`${base}.png`, b64, { base64: true });
          }
          for (const extra of extraPlots ?? []) {
            const extraUrl = await exportPlotImageData(extra.data, extra.layout, fmt, shape);
            const extraBase = `${base}_${extra.name}`;
            if (fmt === "svg") {
              zip.file(`${extraBase}.svg`, decodeURIComponent(extraUrl.split(",")[1] ?? extraUrl));
            } else {
              zip.file(`${extraBase}.png`, extraUrl.split(",")[1] ?? "", { base64: true });
            }
          }
        }
      }
    })
  );

  const blob = await zip.generateAsync({ type: "blob" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = sanitize(zipName) + ".zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── DTA metadata ─────────────────────────────────────────────────────────────

const META_LABELS: Record<string, string> = {
  TITLE: "Title",      DATE: "Date",           TIME: "Time",
  OPERATOR: "Operator", PSTAT: "Potentiostat",  EXPLAIN: "Technique",
  NOTES: "Notes",      SETUP: "Setup",          GROUPID: "Group",
  TAGS: "Tags",        SCANRATE: "Scan rate",   VLIMIT1: "V limit 1",
  VLIMIT2: "V limit 2", VINIT: "V init",        VFINAL: "V final",
  FREQUENCY: "Frequency", FREQINIT: "Freq init", FREQFINAL: "Freq final",
  NUMFREQ: "Num freq",  IRANGE: "I range",      IRCOMP: "IR comp",
};

export function metaLines(metadata?: Record<string, string>): string[] {
  if (!metadata || Object.keys(metadata).length === 0) return [];
  return Object.entries(metadata)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${META_LABELS[k] ?? k}: ${v}`);
}

export function metaComments(metadata?: Record<string, string>): string[] {
  return metaLines(metadata).map(l => `# ${l}`);
}
