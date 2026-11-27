import { isPublicAddress } from "../../proxy/transport/public-address";

/** Pending checks notice local revocation; there is no authenticated session to revoke on return. */
export async function freshHetznerProbe(input: {
  enrolledAddress: string;
  lookup: () => Promise<{ ipv4: string }>;
  active: () => Promise<boolean>;
  authenticate: (signal: AbortSignal) => Promise<void>;
}) {
  if (!await input.active()) return false;
  const target = await input.lookup();
  if (target.ipv4 !== input.enrolledAddress || !isPublicAddress(target.ipv4) || !await input.active()) return false;
  const abort = new AbortController();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  function watch() {
    watchdog = setTimeout(async () => {
      if (done) return;
      try {
        if (!await input.active()) { abort.abort(); return; }
      } catch { abort.abort(); return; }
      if (!done) watch();
    }, 1000);
  }
  watch();
  try {
    await input.authenticate(abort.signal);
    return !abort.signal.aborted && await input.active();
  } finally {
    done = true;
    clearTimeout(watchdog);
    abort.abort();
  }
}
