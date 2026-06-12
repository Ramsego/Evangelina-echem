import { useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  onClose:  () => void;
  children: React.ReactNode;
}

export default function FullscreenOverlay({ onClose, children }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-forest-900 flex flex-col">
      {children}
    </div>,
    document.body,
  );
}
