// Classic, same-origin script runs before any stylesheet or application paint.
(() => {
  let saved;
  try { saved = localStorage.getItem("factorize-theme"); } catch {}
  document.documentElement.dataset.theme = saved === "light" || saved === "dark"
    ? saved : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
})();
