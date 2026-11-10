import { Disclosure, Summary } from "../../shared/ui";
import { AnsiText } from "./ansi-text";
import Markdown from "react-markdown";
import type { operations } from "factorize-api-client";
type Event = operations["get_api_v1_runs_runId_trace_pages"]["responses"][200]["content"]["application/json"]["items"][number];
export function traceClasses(type: string) {
  const variants: Record<string, string> = {
    user_message: "border-l-4 border-l-factorize-600 bg-factorize-50 dark:border-l-factorize-500 dark:bg-factorize-500/5",
    assistant_message: "bg-white dark:bg-slate-900",
    reasoning: "border-dashed bg-stone-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
    tool_call: "bg-stone-100 dark:bg-slate-800",
    command: "bg-stone-100 dark:bg-slate-800",
    error: "border-red-300 dark:border-red-800",
  };
  return variants[type] ?? "bg-white dark:bg-slate-900";
}
const MAX_TOOL_TEXT = 4000;
function shortenMiddle(value: string) {
  if (value.length <= MAX_TOOL_TEXT) return value;
  const half = Math.floor((MAX_TOOL_TEXT - 3) / 2);
  return `${value.slice(0, half)}...${value.slice(-half)}`;
}
export function EventBody({ event }: { event: Event }) {
  // Raw HTML is rendered as text. No rehype-raw or innerHTML; Markdown's default
  // URL transform excludes javascript/data links, and external links are isolated.
  if (["user_message", "assistant_message", "reasoning"].includes(event.type)) return <div className="trace-content"><Markdown components={{ code: ({ children, className }) => <code className={className}>{className && typeof children === "string" ? children.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|var|function|return|if|else|import|export|async|await|class|def|true|false|null|None)\b)/g).map((part, index) => /^(?:["']|const\b|let\b|var\b|function\b|return\b|if\b|else\b|import\b|export\b|async\b|await\b|class\b|def\b|true\b|false\b|null\b|None\b)/.test(part) ? <span key={index} className={part.startsWith('"') || part.startsWith("'") ? "text-emerald-800 dark:text-emerald-300" : "text-factorize-700 dark:text-factorize-500"}>{part}</span> : part) : children}</code>, pre: ({ children }) => <pre tabIndex={0}>{children}</pre>, a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{event.preview}</Markdown></div>;
  if (event.type === "tool_call") {
    let args = event.display.arguments;
    if (args === undefined) {
      try { args = JSON.parse(event.preview); } catch { args = event.preview; }
    }
    const command = typeof args === "string" ? args : JSON.stringify(args, null, 2);
    return <div className="rounded-lg border border-stone-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{event.title || "Tool call"}</h3>
      <pre aria-label={`${event.title || "Tool"} command`} className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-stone-50 p-3 text-xs dark:bg-slate-950"><code>{shortenMiddle(command ?? "")}</code></pre>
      {Object.keys(event.display).length > 0 && <Disclosure><Summary>Event metadata</Summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(event.display, null, 2)}</pre></Disclosure>}
    </div>;
  }
  if (event.type === "tool_result") return <div className="rounded-lg border border-stone-300 bg-stone-50 p-3 dark:border-slate-700 dark:bg-slate-950">
    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Output</h4>
    <pre aria-label="Tool output" className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs"><code><AnsiText text={shortenMiddle(event.preview)} /></code></pre>
    {Object.keys(event.display).length > 0 && <Disclosure><Summary>Event metadata</Summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(event.display, null, 2)}</pre></Disclosure>}
  </div>;
  const content = event.preview;
  return <div>{event.type === "command" && <pre className="whitespace-pre-wrap break-words"><code>{event.title}</code></pre>}<pre className="terminal whitespace-pre-wrap break-words"><code><AnsiText text={content} /></code></pre>{Object.keys(event.display).length > 0 && <Disclosure><Summary>Event metadata</Summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(event.display, null, 2)}</pre></Disclosure>}</div>;
}
