import { useEffect, useState } from "react";
export function ThemeToggle() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("factorize-theme") === "light" ? "light" : "dark"; } catch { return "dark"; } });
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return <button aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => { const next = theme === "dark" ? "light" : "dark"; setTheme(next); try { localStorage.setItem("factorize-theme", next); } catch {} }}>{theme === "dark" ? "Light" : "Dark"} theme</button>;
}
