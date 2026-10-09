import { AnsiText } from "./ansi-text";
import Markdown from "react-markdown";
import type { operations } from "factorize-api-client";
type Event = operations["get_api_v1_runs_runId_trace_pages"]["responses"][200]["content"]["application/json"]["items"][number];
export function EventBody({ event }: { event: Event }) {
  // Raw HTML is rendered as text. No rehype-raw or innerHTML; Markdown's default
  // URL transform excludes javascript/data links, and external links are isolated.
  if (["user_message", "assistant_message", "reasoning"].includes(event.type)) return <div className="trace-content"><Markdown components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{event.preview}</Markdown></div>;
  let content = event.preview;
  if (event.type === "tool_call") { try { content = JSON.stringify(JSON.parse(content), null, 2); } catch {} }
  return <div>{event.type === "command" && <pre className="whitespace-pre-wrap break-words"><code>{event.title}</code></pre>}<pre className="whitespace-pre-wrap break-words"><code><AnsiText text={content} /></code></pre>{Object.keys(event.display).length > 0 && <details><summary>Event metadata</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(event.display, null, 2)}</pre></details>}</div>;
}
