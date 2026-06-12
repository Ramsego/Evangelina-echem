import { useState, useCallback, useEffect, useRef } from "react";

// Same-tab sync: the browser's 'storage' event only fires in OTHER tabs, so
// hook instances sharing a key subscribe here and notify each other on set.
const subscribers = new Map<string, Set<(v: unknown) => void>>();

export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : initial;
    } catch {
      return initial;
    }
  });

  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    const sub = (v: unknown) => setValue(v as T);
    let subs = subscribers.get(key);
    if (!subs) { subs = new Set(); subscribers.set(key, subs); }
    subs.add(sub);
    return () => {
      subs.delete(sub);
      if (subs.size === 0) subscribers.delete(key);
    };
  }, [key]);

  const set = useCallback((next: T) => {
    try {
      localStorage.setItem(keyRef.current, JSON.stringify(next));
    } catch {
      // localStorage full or unavailable — degrade silently
    }
    const subs = subscribers.get(keyRef.current);
    if (subs?.size) {
      for (const sub of subs) sub(next);
    } else {
      setValue(next);
    }
  }, []);

  return [value, set] as const;
}
