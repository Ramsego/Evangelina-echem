import { ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export default function InfoModal({ title, onClose, children }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative z-10 w-full max-w-lg max-h-[80vh] overflow-y-auto
                      bg-forest-850 border border-forest-600 rounded-xl shadow-2xl"
           onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-forest-700">
          <span className="text-sm font-semibold text-forest-200">{title}</span>
          <button onClick={onClose} className="text-forest-500 hover:text-forest-200 transition-colors">
            <X size={15} />
          </button>
        </div>
        {/* Body */}
        <div className="px-5 py-4 text-xs text-forest-300 space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}

export function Calc({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-semibold text-forest-200 mb-1">{name}</p>
      <div className="space-y-1 leading-relaxed">{children}</div>
    </div>
  );
}

export function Formula({ children }: { children: ReactNode }) {
  return (
    <pre className="bg-forest-900 border border-forest-700 rounded px-3 py-1.5
                    text-forest-300 font-mono text-[11px] whitespace-pre-wrap">
      {children}
    </pre>
  );
}
