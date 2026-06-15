import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation } from "@tanstack/react-query";
import { FlaskConical, Upload, Loader2 } from "lucide-react";
import { ParsedFile } from "../types";
import { uploadFiles, fetchSample } from "../api/client";
import { APP_NAME, APP_SUBTITLE } from "../constants";
import clsx from "clsx";
import CVRibbonHero from "./CVRibbonHero";

interface Props {
  onFilesAdded: (files: ParsedFile[]) => void;
}

export default function LandingPage({ onFilesAdded }: Props) {
  const uploadMut = useMutation({
    mutationFn: uploadFiles,
    onSuccess: onFilesAdded,
  });

  const sampleMut = useMutation({
    mutationFn: fetchSample,
    onSuccess: onFilesAdded,
  });

  const onDrop = useCallback(
    async (accepted: File[]) => {
      setDropError(null);
      const dta = accepted.filter((f) => f.name.toLowerCase().endsWith(".dta"));
      if (!dta.length) {
        setDropError("No .dta files found. Drop Gamry .dta files to continue.");
        return;
      }
      try {
        await Promise.all(dta.map((f) => f.slice(0, 1).arrayBuffer()));
      } catch {
        setDropError(
          "One or more files could not be read. If they are stored in OneDrive, iCloud, or Google Drive, make them available offline first."
        );
        return;
      }
      uploadMut.mutate(dta);
    },
    [uploadMut]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/octet-stream": [".dta"] },
    multiple: true,
  });

  const [dropError, setDropError] = useState<string | null>(null);
  const [slowLoad, setSlowLoad] = useState(false);
  const busy = uploadMut.isPending || sampleMut.isPending;
  const sampleBusy = sampleMut.isPending;

  // Free-tier backends sleep after idle and take 30–60s to wake. If a request
  // stays pending past 4s, reassure the user it's waking up rather than broken.
  useEffect(() => {
    if (!busy) { setSlowLoad(false); return; }
    const t = setTimeout(() => setSlowLoad(true), 4000);
    return () => clearTimeout(t);
  }, [busy]);

  return (
    <div className="min-h-screen bg-forest-900 flex flex-col items-center justify-center px-6 py-16"
         style={{
           backgroundImage: [
             "radial-gradient(ellipse at 20% 30%, var(--cvh-glow-a) 0%, transparent 55%)",
             "radial-gradient(ellipse at 80% 70%, var(--cvh-glow-b) 0%, transparent 55%)",
           ].join(", "),
         }}>

      {/* CV ribbon hero */}
      <div className="w-full max-w-3xl mb-10">
        <CVRibbonHero />
      </div>

      {/* Name + subtitle — grouped identity block, set apart from the rest */}
      <div className="flex flex-col items-center mb-12">
        <h1 className="eva-title text-5xl sm:text-6xl font-bold tracking-tight leading-none mb-2 text-center">
          {APP_NAME}
        </h1>
        <p className="text-forest-400 text-xs uppercase tracking-[0.2em] text-center">
          {APP_SUBTITLE}
        </p>
      </div>

      {/* Tagline */}
      <p className="text-forest-400 text-base mb-8 text-center max-w-md">
        Turn raw Gamry files into publication-ready plots in minutes — drag, arrange, and compare freely.
      </p>

      {/* Primary CTA — try the app instantly with bundled sample data */}
      <button
        type="button"
        onClick={() => sampleMut.mutate()}
        disabled={busy}
        className="w-full max-w-md flex items-center justify-center gap-2.5 rounded-xl px-8 py-4
                   bg-forest-600 hover:bg-forest-500 text-forest-100 font-semibold text-sm
                   shadow-lg shadow-forest-900/40 transition-colors
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-300
                   disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {sampleBusy
          ? <Loader2 size={18} className="animate-spin" />
          : <FlaskConical size={18} />}
        {sampleBusy
          ? (slowLoad ? "Waking up the server — first load can take up to a minute…" : "Loading sample data…")
          : "Try with sample data"}
      </button>
      {sampleMut.isError && (
        <p className="text-xs text-red-400 mt-2 max-w-md text-center">
          {(sampleMut.error as Error).message}
          {" "}If this is the first visit in a while, the free-tier server may still be waking — try again in a moment.
        </p>
      )}

      {/* Divider */}
      <div className="w-full max-w-md flex items-center gap-3 my-5">
        <span className="flex-1 h-px bg-forest-700/60" />
        <span className="text-xs text-forest-600 uppercase tracking-wider">or</span>
        <span className="flex-1 h-px bg-forest-700/60" />
      </div>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={clsx(
          "w-full max-w-md rounded-xl border-2 border-dashed px-8 py-10 flex flex-col items-center gap-3 cursor-pointer transition-all",
          isDragActive
            ? "border-forest-400 bg-forest-700/20"
            : "border-forest-700 hover:border-forest-500 hover:bg-forest-800/30"
        )}
      >
        <input {...getInputProps()} />
        {busy
          ? <Loader2 size={24} className="text-forest-400 animate-spin" />
          : <Upload size={24} className="text-forest-500" />
        }
        <p className="text-sm text-forest-400 text-center leading-relaxed">
          {isDragActive
            ? "Drop your .dta files here"
            : "Drop your Gamry .dta files here, or click to browse"}
        </p>
        {!isDragActive && (
          <p className="text-xs text-forest-600 text-center">
            Supports CV, LSV, EIS, and GCD experiment types
          </p>
        )}
        {dropError && (
          <p className="text-xs text-red-400 mt-1 text-center">{dropError}</p>
        )}
        {!dropError && uploadMut.isPending && slowLoad && (
          <p className="text-xs text-forest-400 mt-1 text-center">
            Waking up the server — first load can take up to a minute…
          </p>
        )}
        {!dropError && uploadMut.isError && (
          <p className="text-xs text-red-400 mt-1">
            {(uploadMut.error as Error).message}
          </p>
        )}
      </div>

      <p className="text-xs text-forest-600 mt-6 text-center max-w-sm">
        Files are processed temporarily for analysis and are not stored permanently. Data expires automatically.
      </p>
    </div>
  );
}
