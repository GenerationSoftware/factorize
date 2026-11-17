import type { RunHandle } from "./execution";
/** Signed grants authorize one upload, but never replace vendor authentication.
 * The guest's local helper supplies vendor proof to the same backend origin. */
export function runArtifactTarget(handle: RunHandle, uploadUrl: string): string {
  const url = new URL(uploadUrl);
  if (!handle.identityProxyOrigin || url.origin !== handle.identityProxyOrigin || !/^\/internal\/run-(?:artifacts|trace-chunks)\/[^/]+$/.test(url.pathname)) throw new Error("Vendor-authenticated artifact target unavailable");
  return `http://127.0.0.1:18180${url.pathname}${url.search}`;
}
