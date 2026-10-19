import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveState = "idle" | "saving" | "saved" | "error";
type Options<T> = { value: T; enabled: boolean; validate: (value: T) => string | undefined; save: (value: T) => Promise<void> };

export function useDebouncedAutosave<T>({ value, enabled, validate, save }: Options<T>) {
  const [state, setState] = useState<AutosaveState>("idle"), [error, setError] = useState<string>();
  const current = useRef(value), validateRef = useRef(validate), saveRef = useRef(save), timer = useRef<number | undefined>(undefined), inFlight = useRef(false), queued = useRef(false);
  current.current = value; validateRef.current = validate; saveRef.current = save;
  const run = useCallback(async () => {
    const snapshot = current.current, validationError = validateRef.current(snapshot);
    if (validationError) { setError(validationError); setState("error"); return; }
    if (inFlight.current) { queued.current = true; return; }
    inFlight.current = true; queued.current = false; setError(undefined); setState("saving");
    try { await saveRef.current(snapshot); setState("saved"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save changes."); setState("error"); }
    finally { inFlight.current = false; if (queued.current) { queued.current = false; window.setTimeout(() => void run(), 0); } }
  }, []);
  const valueKey = JSON.stringify(value);
  useEffect(() => {
    if (!enabled) return;
    setState("idle"); setError(undefined); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void run(), 350);
    return () => window.clearTimeout(timer.current);
  }, [enabled, valueKey, run]);
  return { state, error, saveNow: run };
}

export function AutosaveStatus({ state, error, label = "Changes" }: { state: AutosaveState; error?: string; label?: string }) {
  if (state === "saving") return <p role="status" aria-live="polite">Saving {label.toLowerCase()}…</p>;
  if (state === "saved") return <p role="status" aria-live="polite">{label} saved.</p>;
  if (state === "error") return <p role="alert">{error}</p>;
  return null;
}
