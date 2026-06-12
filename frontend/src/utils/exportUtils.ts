import type { CollectResult } from "../context/ExportContext";

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ── Image export ─────────────────────────────────────────────────────────────

async function getPlotly() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const P = (await import("plotly.js")) as any;
  return P.default ?? P;
}

/** Render plot offscreen and return a data-URL string (PNG base64 or SVG). */
export async function exportPlotImageData(
  data: Plotly.Data[],
  layout: Partial<Plotly.Layout>,
  format: "png" | "svg",
): Promise<string> {
  const Plotly = await getPlotly();
  const div = document.createElement("div");
  div.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:1200px;height:900px;visibility:hidden;";
  document.body.appendChild(div);
  try {
    const exportLayout = {
      ...layout,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor:  "rgba(0,0,0,0)",
      width: 1200, height: 900,
    };
    const plotDiv = await Plotly.newPlot(div, data, exportLayout, { staticPlot: true });
    return await Plotly.toImage(plotDiv, { format, width: 1200, height: 900 });
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
): Promise<void> {
  const Plotly = await getPlotly();
  const div = document.createElement("div");
  div.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:1200px;height:900px;visibility:hidden;";
  document.body.appendChild(div);
  try {
    const exportLayout = {
      ...layout,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor:  "rgba(0,0,0,0)",
      width: 1200, height: 900,
    };
    const plotDiv = await Plotly.newPlot(div, data, exportLayout, { staticPlot: true });
    await Plotly.downloadImage(plotDiv, {
      format,
      filename: sanitize(filename),
      width: 1200, height: 900,
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

/**
 * Plain-text summary of computed values, formulas, data regions, warnings and
 * neutral parameter definitions — structured for pasting into an LLM.
 * Contains no interpretation.
 */
export function buildSummaryTxt(
  fileName:   string,
  etypeLabel: string,
  sections:   SummarySection[],
  llmPrompt:  string,
): string {
  const out: string[] = [
    "EChem Studio — Analysis Summary",
    "================================",
    `File: ${fileName}  |  Type: ${etypeLabel}  |  Exported: ${new Date().toISOString().slice(0, 10)}`,
    "",
  ];
  for (const sec of sections) {
    if (sec.lines.length === 0) continue;
    out.push(`--- ${sec.title} ---`, "", ...sec.lines, "");
  }
  out.push("--- Suggested LLM prompt ---", "", llmPrompt, "");
  return out.join("\n");
}

// ── ZIP export (multiple formats) ─────────────────────────────────────────────

/**
 * Build and download a ZIP containing one or more formats for one or more panels.
 * Used when ≥ 2 formats are selected.
 */
export async function buildZip(
  entries: CollectResult[],
  fmts:    Array<"png" | "svg" | "csv" | "txt">,
  zipName: string
): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip   = new JSZip();

  await Promise.all(
    entries.map(async ({ filename, csv, txt, plotData, layout }) => {
      const base = sanitize(filename);
      for (const fmt of fmts) {
        if (fmt === "csv") {
          zip.file(`${base}.csv`, csv);
        } else if (fmt === "txt") {
          if (txt) zip.file(`${base}_summary.txt`, txt);
        } else {
          const dataUrl = await exportPlotImageData(plotData, layout, fmt);
          if (fmt === "svg") {
            const svgText = decodeURIComponent(dataUrl.split(",")[1] ?? dataUrl);
            zip.file(`${base}.svg`, svgText);
          } else {
            const b64 = dataUrl.split(",")[1] ?? "";
            zip.file(`${base}.png`, b64, { base64: true });
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

export function metaComments(metadata?: Record<string, string>): string[] {
  if (!metadata || Object.keys(metadata).length === 0) return [];
  return Object.entries(metadata)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `# ${META_LABELS[k] ?? k}: ${v}`);
}
