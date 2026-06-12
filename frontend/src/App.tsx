import { useState, useMemo, useEffect, useRef } from "react";
import { ParsedFile, ComparisonSession, AnalysisSession } from "./types";
import { fetchCVCurves, deleteFile } from "./api/client";
import LandingPage from "./components/LandingPage";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import { StyleProvider } from "./context/StyleContext";
import { ExportProvider } from "./context/ExportContext";
import { ThemeProvider } from "./context/ThemeContext";
import { FileLabelProvider } from "./context/FileLabelContext";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { DEFAULT_STYLE, StyleSettings } from "./styles/styleTypes";
import { APP_NAME } from "./constants";

const SESSION_KEY = "gamry-session-v1";

export default function App() {
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [comparisons, setComparisons] = useState<ComparisonSession[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisSession[]>([]);
  const [rawStyle, setStyle] = useLocalStorage<StyleSettings>("app.style", DEFAULT_STYLE);
  const style = useMemo(() => ({ ...DEFAULT_STYLE, ...rawStyle }), [rawStyle]);

  useEffect(() => { document.title = APP_NAME; }, []);

  // Restore session on first mount
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { files?: ParsedFile[]; comparisons?: ComparisonSession[]; analyses?: AnalysisSession[] };
      if (saved.files?.length)       setFiles(saved.files);
      if (saved.comparisons?.length) setComparisons(saved.comparisons);
      if (saved.analyses?.length)    setAnalyses(saved.analyses);
    } catch { /* corrupt storage — ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist session on every change (debounced by browser idle)
  useEffect(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ files, comparisons, analyses }));
    } catch {
      // Quota exceeded — strip large curve arrays and retry
      try {
        const stripped = files.map(f =>
          f.curves && f.curves.length > 10
            ? { ...f, curves: undefined, partial: true }
            : f
        );
        localStorage.setItem(SESSION_KEY, JSON.stringify({ files: stripped, comparisons, analyses }));
      } catch { /* give up silently */ }
    }
  }, [files, comparisons, analyses]);

  const addFiles = (incoming: ParsedFile[]) => {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.id));
      return [...prev, ...incoming.filter((f) => !existing.has(f.id))];
    });
  };

  const patchFile = (id: string, patch: Partial<ParsedFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const patchComparison = (id: string, patch: Partial<ComparisonSession>) => {
    setComparisons((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const patchAnalysis = (id: string, patch: Partial<AnalysisSession>) => {
    setAnalyses((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  // Eagerly fetch curves for lazy-uploaded CV/LSV files so comparison panels work
  useEffect(() => {
    files
      .filter((f) => (f.etype === "CV" || f.etype === "LSV") && f.total_curves && !f.curves && !f.partial)
      .forEach((f) => {
        fetchCVCurves(f.id, 1, f.total_curves!).then((res) => {
          patchFile(f.id, { curves: res.curves });
        }).catch(() => { /* server restarted — will need re-upload */ });
      });
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setComparisons((prev) =>
      prev
        .map((c) => ({ ...c, selections: c.selections.filter((s) => s.fileId !== id) }))
        .filter((c) => c.selections.length >= 1)
    );
    setAnalyses((prev) => prev.filter((a) => a.fileId !== id));
    // Best-effort: tell the server to purge cached data for this file.
    // Sample file IDs start with "sample-" and are never in the server cache.
    if (!id.startsWith("sample-")) deleteFile(id).catch(() => {});
  };

  const addComparison = (c: ComparisonSession) => setComparisons((prev) => [...prev, c]);
  const removeComparison = (id: string) => setComparisons((prev) => prev.filter((c) => c.id !== id));

  const addAnalysis = (a: AnalysisSession) => setAnalyses((prev) => prev.some(x => x.id === a.id) ? prev : [...prev, a]);
  const removeAnalysis = (id: string) => setAnalyses((prev) => prev.filter((a) => a.id !== id));

  return (
    <ThemeProvider>
      {files.length === 0 ? (
        <LandingPage onFilesAdded={addFiles} />
      ) : (
        <FileLabelProvider>
          <ExportProvider>
            <StyleProvider globalStyle={style} setGlobal={setStyle}>
              <div className="flex h-screen overflow-hidden bg-forest-900">
                <Sidebar
                  files={files}
                  comparisons={comparisons}
                  onFilesAdded={addFiles}
                  onFileRemoved={removeFile}
                  onComparisonAdded={addComparison}
                  onAnalysisAdded={addAnalysis}
                />
                <Dashboard
                  files={files}
                  comparisons={comparisons}
                  analyses={analyses}
                  onFileRemoved={removeFile}
                  onComparisonRemoved={removeComparison}
                  onAnalysisRemoved={removeAnalysis}
                  onComparisonRenamed={patchComparison}
                  onAnalysisRenamed={patchAnalysis}
                  onAnalysisAdded={addAnalysis}
                />
              </div>
            </StyleProvider>
          </ExportProvider>
        </FileLabelProvider>
      )}
    </ThemeProvider>
  );
}
