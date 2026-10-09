import { useEffect, useState } from "react";
import { Button } from "./ui";
export function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => {
      let saved; try { saved = localStorage.getItem("factorize-theme"); } catch {}
      if (saved !== "light" && saved !== "dark") {
        const next = media.matches ? "dark" : "light";
        document.documentElement.dataset.theme = next; setTheme(next);
      }
    };
    media.addEventListener("change", followSystem);
    return () => media.removeEventListener("change", followSystem);
  }, []);
  return <Button aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next; setTheme(next);
    try { localStorage.setItem("factorize-theme", next); } catch {}
  }}><span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span><span className="sr-only">{theme === "dark" ? "Light" : "Dark"} theme</span></Button>;
}
