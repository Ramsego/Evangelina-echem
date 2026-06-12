import { createContext, useContext, useEffect, useState } from "react";

export type UITheme = "forest" | "dark" | "light";

interface ThemeCtx {
  theme:    UITheme;
  setTheme: (t: UITheme) => void;
}

const Ctx = createContext<ThemeCtx>({ theme: "forest", setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<UITheme>(
    () => (localStorage.getItem("app.theme") as UITheme | null) ?? "forest"
  );

  function setTheme(t: UITheme) {
    setThemeState(t);
    localStorage.setItem("app.theme", t);
  }

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
