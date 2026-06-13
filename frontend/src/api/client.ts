import {
  ParsedFile,
  CurveData,
  CVRequest, CVResponse,
  TafelRequest, TafelResponse,
  EISResponse,
  GCDRequest, GCDResponse,
  DunnRequest, DunnResponse,
  EISData,
} from "../types";

// In production the frontend is served from the same origin as the API proxy,
// so "/api" works without any env var. Override with VITE_API_BASE_URL only
// when backend and frontend are on different origins.
const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

const NETWORK_ERR = "Cannot reach the server — make sure the backend is running (uvicorn main:app --reload).";

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
  } catch {
    throw new Error(NETWORK_ERR);
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path);
  } catch {
    throw new Error(NETWORK_ERR);
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

const ANALYZE = `${BASE}/analyze`;

export async function uploadFiles(files: File[]): Promise<ParsedFile[]> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  let res: Response;
  try {
    res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  } catch {
    throw new Error(NETWORK_ERR);
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchSample(): Promise<ParsedFile[]> {
  return get(`${BASE}/sample`);
}

export async function analyzeCV(body: CVRequest): Promise<CVResponse> {
  return post(`${ANALYZE}/cv`, body);
}

export async function analyzeTafel(body: TafelRequest): Promise<TafelResponse> {
  return post(`${ANALYZE}/tafel`, body);
}

export async function analyzeEIS(body: { eis: EISData; model?: string }): Promise<EISResponse> {
  return post(`${ANALYZE}/eis`, body);
}

export async function analyzeGCD(body: GCDRequest): Promise<GCDResponse> {
  return post(`${ANALYZE}/gcd`, body);
}

export async function analyzeDunn(body: DunnRequest): Promise<DunnResponse> {
  return post(`${ANALYZE}/dunn`, body);
}

export interface CycleSegment {
  label: string;
  cycle: number;
  start: number;
  end:   number;
}

export async function fetchCycles(
  fileId: string,
  start: number,
  end: number,
): Promise<{ times: number[]; voltages: number[]; segments?: CycleSegment[] }> {
  return get(`${BASE}/files/${fileId}/cycles?start=${start}&end=${end}`);
}

export interface GCDCycleStep {
  times:      number[]
  voltages:   number[]
  currents:   number[]
  energy_mwh: number
}

export async function fetchGCDCycle(
  fileId: string,
  cycle: number,
): Promise<{ cycle: number; charge: GCDCycleStep; discharge: GCDCycleStep }> {
  return get(`${BASE}/files/${fileId}/gcd-cycle?cycle=${cycle}`);
}

export async function deleteFile(fileId: string): Promise<void> {
  const res = await fetch(`${BASE}/files/${fileId}`, { method: "DELETE" });
  // 404 means the server has already evicted it — not an error from the user's perspective
  if (!res.ok && res.status !== 404) throw new Error(await res.text());
}

export interface ExportCapabilities {
  xlsx: true;
  csv:  true;
  opju: boolean;
  opju_message: string | null;
}

let _capCache: ExportCapabilities | null = null;

export async function getExportCapabilities(): Promise<ExportCapabilities> {
  if (_capCache) return _capCache;
  _capCache = await get<ExportCapabilities>(`${BASE}/export/capabilities`);
  return _capCache;
}

export async function exportData(body: object, stem: string, format: "xlsx" | "csv" | "opju"): Promise<void> {
  const res = await fetch(`${BASE}/export`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ...body, format }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Export failed" }));
    throw new Error(err.detail ?? "Export failed");
  }
  const blob = await res.blob();
  const ext  = format === "opju" ? "opju" : format === "xlsx" ? "xlsx" : "csv";
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${stem}_origin.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Export pre-built plotted-only sheets (the panel's exact figure columns). */
export async function exportSheets(
  sheets: object[],
  stem: string,
  format: "xlsx" | "csv" | "opju",
): Promise<void> {
  return exportData({ sheets }, stem, format);
}

export async function fetchCVCurves(
  fileId: string,
  start: number,
  end: number,
): Promise<{ curves: CurveData[]; start: number; end: number; total: number }> {
  return get(`${BASE}/files/${fileId}/curves?start=${start}&end=${end}`);
}
