import { validEmail } from "./auth";
import type { Env } from "./types";

export function validateAuthEmailConfig(env: Env): void {
  const origin = new URL(env.APP_ORIGIN);
  if (origin.protocol !== "https:" || origin.origin !== env.APP_ORIGIN || !env.POSTMARK_SERVER_TOKEN?.trim() || !validEmail(env.POSTMARK_FROM_EMAIL ?? "") || !env.POSTMARK_MESSAGE_STREAM?.trim()) {
    throw new Error("Authentication email requires an HTTPS APP_ORIGIN, POSTMARK_SERVER_TOKEN, POSTMARK_FROM_EMAIL and POSTMARK_MESSAGE_STREAM.");
  }
}

export async function sendAuthEmail(env: Env, email: string, token: string, purpose: "verify" | "reset"): Promise<void> {
  validateAuthEmailConfig(env);
  const url = new URL(purpose === "verify" ? "/auth/verify" : "/auth/password-reset", env.APP_ORIGIN);
  url.searchParams.set("token", token);
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN! },
    body: JSON.stringify({ From: env.POSTMARK_FROM_EMAIL, To: email, MessageStream: env.POSTMARK_MESSAGE_STREAM,
      Subject: purpose === "verify" ? "Verify your Factorize email" : "Reset your Factorize password",
      TextBody: `${purpose === "verify" ? "Verify your email" : "Reset your password"}: ${url}\n\nThis link expires in one hour and can be used once. If you did not request this, ignore this email.` }),
  });
  const result = await response.json() as { ErrorCode?: number };
  if (!response.ok || result.ErrorCode !== 0) throw new Error("Postmark could not deliver authentication email.");
}
