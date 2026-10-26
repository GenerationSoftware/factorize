import { traceClasses, EventBody } from "./event-body";
import { Disclosure, Summary, Card } from "../../shared/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
import type { operations } from "factorize-api-client";

type Event = operations["get_api_v1_runs_runId_trace_pages"]["responses"][200]["content"]["application/json"]["items"][number];
type TracePage = { items: Event[]; nextCursor: number | null; previousCursor?: number | null; revision: string; reset: boolean };
type PageParam = { mode: "recent" | "before"; cursor?: number; revision?: string };
type ConversationItem = { kind: "assistant"; event: Event } | { kind: "tools"; events: Event[]; count: number };

function conversation(events: Event[]): ConversationItem[] {
  const visible = events.filter(event => ["assistant_message", "tool_call", "tool_result"].includes(event.type));
  const result: ConversationItem[] = [];
  for (const event of visible) {
    if (event.type === "assistant_message") result.push({ kind: "assistant", event });
    else {
      const previous = result.at(-1);
      if (previous?.kind === "tools") { previous.events.push(event); if (event.type === "tool_call") previous.count += 1; }
      else result.push({ kind: "tools", events: [event], count: event.type === "tool_call" ? 1 : 0 });
    }
  }
  return result;
}

export function ContinuousTrace({ runId, revision, active, onReset }: { runId: string; revision: string; active: boolean; onReset: (revision: string) => void }) {
  const [liveItems, setLiveItems] = useState<Event[]>([]);
  const [atBottom, setAtBottom] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const trace = useInfiniteQuery<TracePage, Error, InfiniteData<TracePage>, string[], PageParam>({
    queryKey: ["runs", runId, "conversation-trace", revision],
    initialPageParam: { mode: "recent" } as PageParam,
    queryFn: async ({ signal, pageParam }) => {
      const query = pageParam.mode === "recent" ? { recent: true, revision: pageParam.revision, limit: 100 } : { before: pageParam.cursor, revision: pageParam.revision, limit: 100 };
      const { data, error } = await api.GET("/api/v1/runs/{runId}/trace-pages", { signal, params: { path: { runId }, query } });
      if (!data || error) throw new Error(messageOf(error));
      return data;
    },
    enabled: !!revision, getNextPageParam: page => page.previousCursor == null ? undefined : { mode: "before", cursor: page.previousCursor, revision: page.revision } as PageParam,
    staleTime: Infinity, retry: 1,
  });
  const pages = trace.data?.pages ?? [];
  const items = useMemo(() => [...pages.flatMap(page => page.items), ...liveItems].filter((event, index, all) => all.findIndex(candidate => candidate.id === event.id) === index).sort((a, b) => a.sequence - b.sequence), [pages, liveItems]);
  const latestSequence = items.at(-1)?.sequence ?? 0;
  const live = useQuery({
    queryKey: ["runs", runId, "conversation-tail", revision, latestSequence],
    enabled: active && !!trace.data && !trace.isFetching,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/v1/runs/{runId}/trace-pages", { signal, params: { path: { runId }, query: { after: latestSequence, revision, limit: 100 } } });
      if (!data || error) throw new Error(messageOf(error)); return data;
    },
    refetchIntervalInBackground: false, refetchInterval: query => query.state.error ? 10_000 : 2_000, retry: 1,
  });
  useEffect(() => { const changed = live.data?.reset ? live.data : pages.find(page => page.reset || page.revision !== revision); if (changed) onReset(changed.revision); }, [live.data, pages, revision, onReset]);
  useEffect(() => { if (live.data && !live.data.reset && live.data.revision === revision) setLiveItems(previous => [...previous, ...live.data!.items]); }, [live.data, revision]);
  useEffect(() => { setLiveItems([]); setExpanded(new Set()); }, [revision]);
  useEffect(() => {
    const onScroll = () => { const bottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 48; setAtBottom(bottom); if (window.scrollY < 160 && trace.hasNextPage && !trace.isFetching) { anchor.current = { height: document.documentElement.scrollHeight, top: window.scrollY }; void trace.fetchNextPage(); } };
    window.addEventListener("scroll", onScroll, { passive: true }); return () => window.removeEventListener("scroll", onScroll);
  }, [trace.hasNextPage, trace.isFetching, trace.fetchNextPage]);
  useEffect(() => { if (!anchor.current || trace.isFetching) return; const previous = anchor.current; anchor.current = null; window.scrollTo({ top: previous.top + document.documentElement.scrollHeight - previous.height, behavior: "auto" }); }, [items.length, trace.isFetching]);
  useEffect(() => { if (atBottom && live.data?.items.length) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }); }, [atBottom, live.data]);
  useEffect(() => { if (trace.data && !trace.isFetching && pages.length === 1 && items.length) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" }); }, [trace.data, trace.isFetching]);
  const grouped = conversation(items);
  return <Card className="border-0 p-0 shadow-none">{trace.error && <p role="alert">{trace.error.message}</p>}{trace.isPending && <p role="status">Loading conversation…</p>}
    {!trace.isPending && !grouped.length && <p className="text-sm text-slate-600 dark:text-slate-400">No assistant messages yet.</p>}
    <div data-run-trace className="min-w-0 space-y-4" aria-live={active ? "polite" : undefined}>{grouped.map((item, index) => item.kind === "assistant" ? <article key={item.event.id} className="min-w-0"><EventBody event={item.event} /></article> : <Disclosure key={item.events[0]?.id + ":" + index} className={traceClasses("tool_call")} open={expanded.has(item.events[0]?.id + ":" + index)} onToggle={event => { const key = item.events[0]?.id + ":" + index; setExpanded(previous => { const next = new Set(previous); event.currentTarget.open ? next.add(key) : next.delete(key); return next; }); }}><Summary>{item.count} Tool Call{item.count === 1 ? "" : "s"}</Summary><div className="space-y-3">{item.events.map(event => <div key={event.id}><EventBody event={event} /></div>)}</div></Disclosure>)}</div>
    {active && <p role="status" className="mt-5 text-sm font-medium"><span aria-hidden="true" className="mr-2 inline-block motion-safe:animate-pulse">●</span>Running…</p>}
  </Card>;
}
