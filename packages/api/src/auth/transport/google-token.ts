import { fetchWithoutRedirects, OutboundRedirectError } from "../../transport/http/fetch-without-redirects";
import { z } from "zod";
import { GoogleCallbackFailure, googleCallbackStage } from "./google-callback-diagnostics";

const tokenUrl = "https://oauth2.googleapis.com/token";

export async function requestGoogleIdToken(form: {
  grant_type: "authorization_code";
  code: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  code_verifier: string;
}) {
  const token = await googleCallbackStage("token_transport", async () => {
    try {
      return await fetchWithoutRedirects(tokenUrl, { method: "POST", signal: AbortSignal.timeout(10_000), body: new URLSearchParams(form) });
    } catch (error) {
      if (error instanceof OutboundRedirectError) throw new GoogleCallbackFailure("token_rejected");
      throw error;
    }
  });
  if (!token.ok) {
    const { error } = await token.json().then(value => z.object({ error: z.unknown().optional() }).parse(value)).catch(() => ({ error: undefined }));
    throw new GoogleCallbackFailure(error === "invalid_client" ? "token_invalid_client" : error === "invalid_grant" ? "token_invalid_grant" : "token_rejected");
  }
  const { id_token } = await googleCallbackStage("token_response", async () => z.object({ id_token: z.string().min(1).max(16384) }).parse(await token.json()));
  return id_token;
}
