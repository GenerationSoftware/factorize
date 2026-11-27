type FailureCode =
  | "authorization_header"
  | "callback_input"
  | "provider_denied"
  | "attempt_unavailable"
  | "attempt_store"
  | "token_transport"
  | "token_rejected"
  | "token_invalid_client"
  | "token_invalid_grant"
  | "token_response"
  | "id_token_shape"
  | "id_token_claims"
  | "google_signing_key"
  | "id_token_signature"
  | "account_store"
  | "account_unavailable"
  | "account_collision"
  | "connection_unavailable"
  | "session_completion";

export class GoogleCallbackFailure extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}

/** Replace exceptions from a stage with a fixed code, never forwarding their contents. */
export async function googleCallbackStage<T>(code: FailureCode, run: () => T | Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (error instanceof GoogleCallbackFailure) throw error;
    throw new GoogleCallbackFailure(code);
  }
}

/** Do not log request URLs, provider response bodies, exceptions, or identity data. */
export function reportGoogleCallbackFailure(request: Request, code: FailureCode) {
  const ray = request.headers.get("CF-Ray");
  const rayId = ray && /^[0-9a-fA-F]{16}(?:-[A-Z]{3})?$/.test(ray) ? ray : undefined;
  console.warn("factorize.google_callback_failed", { code, ...(rayId ? { rayId } : {}) });
}
