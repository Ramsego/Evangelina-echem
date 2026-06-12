import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation } from "@tanstack/react-query";
import { FlaskConical, Upload, Loader2 } from "lucide-react";
import { ParsedFile } from "../types";
import { uploadFiles } from "../api/client";
import { APP_NAME } from "../constants";
import clsx from "clsx";

const BADGES = ["CV & LSV", "EIS", "GCD", "Tafel & ESR", "Origin Export", "Publication Styles"];

interface Props {
  onFilesAdded: (files: ParsedFile[]) => void;
}

export default function LandingPage({ onFilesAdded }: Props) {
  const uploadMut = useMutation({
    mutationFn: uploadFiles,
    onSuccess: onFilesAdded,
  });

  const onDrop = useCallback(
    (accepted: File[]) => {
      const dta = accepted.filter((f) => f.name.toLowerCase().endsWith(".dta"));
      if (dta.length) uploadMut.mutate(dta);
    },
    [uploadMut]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/octet-stream": [".dta"] },
    multiple: true,
  });

  const busy = uploadMut.isPending;

  return (
    <div className="min-h-screen bg-forest-900 flex flex-col items-center justify-center px-6 py-16"
         style={{
           backgroundImage: "radial-gradient(ellipse at 50% 52%, rgba(45,106,79,0.55) 0%, rgba(27,67,50,0.30) 40%, transparent 70%)",
         }}>

      {/* Logo + name */}
      <div className="flex items-center gap-3 mb-4">
        <FlaskConical size={28} className="text-forest-400" />
        <span className="text-2xl font-semibold text-forest-100 tracking-tight">
          {APP_NAME}
        </span>
      </div>

      {/* Tagline */}
      <p className="text-forest-400 text-base mb-8 text-center max-w-md">
        Electrochemical data analysis — drag, arrange, and compare plots freely.
      </p>

      {/* Feature badges */}
      <div className="flex flex-wrap justify-center gap-2 mb-10">
        {BADGES.map((b) => (
          <span key={b}
                className="px-3 py-1 rounded-full text-xs font-medium
                           bg-forest-700/40 border border-forest-600/40 text-forest-300">
            {b}
          </span>
        ))}
      </div>

      {/* Demo GIF */}
      <div className="w-full max-w-3xl rounded-2xl overflow-hidden border border-forest-700/50 mb-10"
           style={{ boxShadow: "0 0 80px rgba(64,145,108,0.20), 0 0 160px rgba(64,145,108,0.08)" }}>
        <img src="/demo.gif" alt="App demo" className="w-full block" />
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
        {uploadMut.isError && (
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
