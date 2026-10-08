import { pathToFileURL } from "node:url";

/** Validate deployment credentials without printing them. Sends one preflight email to the sender. */
export async function validatePostmark(env, request = fetch) {
  const { APP_ORIGIN, POSTMARK_SERVER_TOKEN, POSTMARK_FROM_EMAIL, POSTMARK_MESSAGE_STREAM } = env;
  if (!APP_ORIGIN || !POSTMARK_SERVER_TOKEN?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(POSTMARK_FROM_EMAIL ?? "") || !POSTMARK_MESSAGE_STREAM?.trim()) throw new Error("Configure APP_ORIGIN, POSTMARK_SERVER_TOKEN, POSTMARK_FROM_EMAIL and POSTMARK_MESSAGE_STREAM before deployment.");
  const origin = new URL(APP_ORIGIN);
  if (origin.protocol !== "https:" || origin.origin !== APP_ORIGIN) throw new Error("APP_ORIGIN must be an HTTPS origin without a trailing slash.");
  const headers = { "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN, "Content-Type": "application/json", Accept: "application/json" };
  const streamResponse = await request(`https://api.postmarkapp.com/message-streams/${encodeURIComponent(POSTMARK_MESSAGE_STREAM)}`, { headers });
  const stream = await streamResponse.json();
  if (!streamResponse.ok || stream.MessageStreamType !== "Transactional" || stream.ArchivedAt) throw new Error("Postmark requires a valid server token and an active transactional message stream.");
  const emailResponse = await request("https://api.postmarkapp.com/email", { method: "POST", headers, body: JSON.stringify({
    From: POSTMARK_FROM_EMAIL, To: POSTMARK_FROM_EMAIL, MessageStream: POSTMARK_MESSAGE_STREAM,
    Subject: "Factorize authentication email deployment check",
    TextBody: `Authentication email configuration for ${APP_ORIGIN} passed the deployment preflight.`,
  }) });
  const email = await emailResponse.json();
  if (!emailResponse.ok || email.ErrorCode !== 0) throw new Error("Postmark rejected the preflight email. Confirm sender/domain verification and server sending permissions.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await validatePostmark(process.env); console.log("Postmark authentication email preflight passed."); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
