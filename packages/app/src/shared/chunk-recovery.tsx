import { Button } from "./ui";
import { useEffect, useState } from "react";
/** Never reload automatically: a newly deployed chunk must not erase a form draft. */
export function ChunkRecovery() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const handler = (event: Event) => { event.preventDefault(); setFailed(true); };
    window.addEventListener("vite:preloadError", handler);
    return () => window.removeEventListener("vite:preloadError", handler);
  }, []);
  if (!failed) return null;
  return <aside role="alert" className="p-4 border"><p>A page could not load. Copy any unsaved changes before reloading.</p><Button onClick={() => { if (window.confirm("Reload this page? Unsaved changes will be lost.")) window.location.reload(); }}>Reload page</Button><Button onClick={() => setFailed(false)}>Keep working</Button></aside>;
}
