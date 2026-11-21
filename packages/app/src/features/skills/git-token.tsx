import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Input, Label } from "../../shared/ui";
import { messageOf } from "../auth/session";

/** Shared personal HTTPS Git credential flow; mount only for Factorize-managed repositories. */
export function GitToken({ buttonLabel = "Get Git Token", buttonClassName = "" }: { buttonLabel?: string; buttonClassName?: string }) {
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState("");
  const token = useMutation({ retry: false, gcTime: 0, mutationFn: async () => {
    const { data, error } = await api.POST("/api/v1/skill-library/git-token");
    if (error || !data) throw new Error(messageOf(error)); return data;
  } });
  useEffect(() => () => token.reset(), []);
  const copy = async () => { setCopyError(""); try { await navigator.clipboard.writeText(token.data!.token); setCopied(true); } catch { setCopyError("Copy unavailable. Select the text and copy it."); } };
  return <div className="min-w-0 space-y-2">
    {!token.data ? <Button className={buttonClassName} disabled={token.isPending} onClick={() => token.mutate()}>{token.isPending ? "Creating token…" : buttonLabel}</Button> : <div className="space-y-2 rounded-lg bg-stone-50 p-3 dark:bg-slate-950">
      <p className="text-xs">Username: <code>{token.data.username}</code>. Use this token as the password.</p>
      <div className="flex items-end gap-2"><Label className="min-w-0 flex-1">Git token<Input type="password" readOnly autoComplete="off" value={token.data.token} onFocus={event => event.target.select()}/></Label><Button aria-label="Copy Git token" onClick={() => void copy()}>{copied ? "✓" : "Copy"}</Button></div>
      <p className="text-xs text-slate-600 dark:text-slate-400">Expires {new Date(token.data.expiresAt).toLocaleTimeString()}. Store it in your Git credential manager.</p>
    </div>}
    {token.error && <p role="alert">{token.error.message}</p>}{copied && <p role="status" className="text-xs">Git token copied.</p>}{copyError && <p role="alert">{copyError}</p>}
  </div>;
}
