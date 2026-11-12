import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Input, Label } from "../../shared/ui";
import { createUnlockSetup, generateUnlockKey, getUnlockVerification, replaceUnlockKeyGeneration, verifyUnlockKey } from "../../lib/unlock-key";

export function UnlockKeySetup() {
  const cache = useQueryClient();
  const verification = useQuery({ queryKey: ["unlock-key-verification"], queryFn: ({ signal }) => getUnlockVerification(signal), retry: false });
  const [pendingKey, setPendingKey] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [enteredKey, setEnteredKey] = useState("");
  const [replacementMode, setReplacementMode] = useState<"rotate" | "reset" | null>(null);
  const [verified, setVerified] = useState(false);
  const setup = useMutation({ retry: false, mutationFn: async () => {
    if (!verification.data || verification.data.verification || !pendingKey || !acknowledged) throw new Error("Save and acknowledge your unlock key before setup.");
    return createUnlockSetup(verification.data.ownerId, pendingKey, crypto.randomUUID());
  }, onSuccess: async () => { setPendingKey(""); setAcknowledged(false); await cache.invalidateQueries({ queryKey: ["unlock-key-verification"] }); } });
  const check = useMutation({ retry: false, mutationFn: async () => {
    const current = verification.data?.verification;
    if (!current || !verification.data) throw new Error("Set up an unlock key before verifying it.");
    await verifyUnlockKey(enteredKey, verification.data.ownerId, current.generationId, JSON.parse(current.encryptedVerification));
  }, onSuccess: () => setVerified(true), onError: () => setVerified(false) });
  const replace = useMutation({ retry: false, mutationFn: async () => {
    if (!replacementMode || !pendingKey || !acknowledged || (replacementMode === "rotate" && !enteredKey)) throw new Error("Generate and save the new key before continuing.");
    return replaceUnlockKeyGeneration(replacementMode === "rotate" ? enteredKey : null, pendingKey, replacementMode);
  }, onSuccess: async () => {
    setPendingKey(""); setEnteredKey(""); setAcknowledged(false); setVerified(false); setReplacementMode(null);
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["unlock-key-verification"] }),
      cache.invalidateQueries({ queryKey: ["settings", "bearer-integrations"] }),
      cache.invalidateQueries({ queryKey: ["settings", "model-accounts"] }),
    ]);
  }, onError: async () => {
    setPendingKey(""); setEnteredKey(""); setAcknowledged(false); setVerified(false); setReplacementMode(null);
    await cache.invalidateQueries({ queryKey: ["unlock-key-verification"] });
  } });
  const resetPending = () => { setPendingKey(""); setAcknowledged(false); };
  return <Card className="mb-6 space-y-3" aria-labelledby="unlock-key-heading">
    <h2 id="unlock-key-heading">Unlock key</h2>
    {verification.isPending && <p role="status">Checking unlock key setup…</p>}
    {verification.error && <p role="alert">{verification.error.message}</p>}
    {verification.data && !verification.data.verification && <>
      <p>Generate a key and save it somewhere safe. Factorize cannot recover it. The key is shown once and is never saved in this browser.</p>
      {!pendingKey ? <Button type="button" disabled={verification.isPending} onClick={() => setPendingKey(generateUnlockKey())}>Generate unlock key</Button> : <>
        <Label>New unlock key <Input readOnly value={pendingKey} autoComplete="off" /></Label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I saved this key somewhere safe.</label>
        <Button type="button" disabled={!acknowledged || setup.isPending} onClick={() => setup.mutate()}>{setup.isPending ? "Saving verification…" : "I saved my key"}</Button>
        <Button type="button" onClick={resetPending}>Cancel setup</Button>
      </>}
    </>}
    {verification.data?.verification && <>
      <p>Unlock key verification is set up. Enter your saved key to verify it before encrypting changes. The key is kept only in memory while this page is open.</p>
      <Label>Unlock key <Input type="password" autoComplete="off" value={enteredKey} onChange={event => { setEnteredKey(event.target.value); setVerified(false); }} /></Label>
      <Button type="button" disabled={!enteredKey || check.isPending} onClick={() => check.mutate()}>{check.isPending ? "Verifying…" : "Verify unlock key"}</Button>
      {verified && <p role="status">Unlock key verified for this account and generation.</p>}
      {check.error && <p role="alert">Unlock key could not be verified for this account and generation.</p>}
      {!replacementMode && <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => { setReplacementMode("rotate"); setPendingKey(generateUnlockKey()); setAcknowledged(false); }}>Rotate unlock key</Button>
        <Button type="button" variant="destructive" onClick={() => { if (window.confirm("Reset all integrations and model accounts? This cannot recover records encrypted with the lost key.")) { setEnteredKey(""); setVerified(false); setReplacementMode("reset"); setPendingKey(generateUnlockKey()); setAcknowledged(false); } }}>Reset integrations and model accounts</Button>
      </div>}
      {replacementMode && <div className="space-y-3 rounded border p-3">
        <p>{replacementMode === "rotate" ? "Save this new key before replacing the current key. All active integrations and pending changes will be re-encrypted." : "Save this new key before reset. All integrations and model accounts will be deleted; Fly connection and execution settings will be preserved."}</p>
        <Label>New unlock key <Input readOnly value={pendingKey} autoComplete="off" /></Label>
        {replacementMode === "rotate" && <Label>Current unlock key <Input type="password" autoComplete="off" value={enteredKey} onChange={event => setEnteredKey(event.target.value)} /></Label>}
        <label className="flex items-start gap-2"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I saved the new key somewhere safe.</label>
        {replace.error && <p role="alert">{replace.error.message}</p>}
        <div className="flex gap-2"><Button type="button" variant="primary" disabled={!acknowledged || replace.isPending || (replacementMode === "rotate" && !enteredKey)} onClick={() => replace.mutate()}>{replace.isPending ? "Replacing key and locking proxy…" : replacementMode === "rotate" ? "Replace unlock key" : "Reset and replace key"}</Button><Button type="button" disabled={replace.isPending} onClick={() => { setReplacementMode(null); setPendingKey(""); setAcknowledged(false); }}>Cancel</Button></div>
      </div>}
    </>}
    {setup.error && <p role="alert">{setup.error.message}</p>}
  </Card>;
}
