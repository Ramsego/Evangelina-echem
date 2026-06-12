import { type ReactNode } from "react";

interface TooltipProps {
  content: string | ReactNode;
  side?: "top" | "bottom";
  className?: string;
  children: ReactNode;
}

export default function Tooltip({ content, side = "bottom", className = "", children }: TooltipProps) {
  const pos = side === "bottom"
    ? "top-full mt-1.5 left-1/2 -translate-x-1/2"
    : "bottom-full mb-1.5 left-1/2 -translate-x-1/2";

  return (
    <span className={`relative inline-flex group ${className}`}>
      {children}
      <span className={`absolute z-50 whitespace-nowrap bg-forest-900 border border-forest-700 text-forest-300 text-[10px] rounded px-2 py-1 shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity delay-150 ${pos}`}>
        {content}
      </span>
    </span>
  );
}
