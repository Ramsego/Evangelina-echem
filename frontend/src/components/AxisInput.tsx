import { useState, useEffect } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}

export default function AxisInput({ value, onChange, placeholder, className }: Props) {
  const [draft, setDraft] = useState(value);

  // Sync draft when parent resets the value (e.g., Reset button clears to "")
  useEffect(() => { setDraft(value); }, [value]);

  const commit = (raw: string) => {
    const v = raw.trim();
    if (v === "" || !isNaN(Number(v))) onChange(v);
    else setDraft(value); // revert on non-numeric input
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") commit(draft);
        if (e.key === "Escape") { setDraft(value); (e.target as HTMLInputElement).blur(); }
      }}
      className={className}
    />
  );
}
