import { useEffect, useState } from "react";

export function useIsSmallScreen(maxPx = 768): boolean {
  const [small, setSmall] = useState(() => window.innerWidth < maxPx);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxPx - 1}px)`);
    const on = () => setSmall(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [maxPx]);
  return small;
}
