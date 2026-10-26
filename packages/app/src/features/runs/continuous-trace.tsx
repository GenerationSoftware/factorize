import { traceClasses, EventBody } from "./event-body";
import { Disclosure, Summary, Card } from "../../shared/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent } from "react";
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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pullDistance, setPullDistance] = useState(0);
  const [pullLoading, setPullLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const historyLoadingRef = useRef(false);
  const pullStartY = useRef<number | null>(null);
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);
  const initialAlignedRevision = useRef<string | null>(null);
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
  useEffect(() => { initialAlignedRevision.current = null; followRef.current = true; }, [revision]);
  const updateScrollState = () => {
    const element = scrollRef.current;
    if (!element) return;
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
    followRef.current = bottom;
  };
  const loadHistory = async (pageCount = 1) => {
    const element = scrollRef.current;
    if (!element || !trace.hasNextPage || trace.isFetching || historyLoadingRef.current) return;
    historyLoadingRef.current = true;
    prependAnchor.current = { height: element.scrollHeight, top: element.scrollTop };
    try {
      for (let page = 0; page < pageCount; page += 1) {
        const result = await trace.fetchNextPage();
        if (!result.data?.pages.at(-1)?.previousCursor) break;
      }
    } finally {
      historyLoadingRef.current = false;
    }
  };
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (scrollRef.current?.scrollTop === 0 && event.touches[0]) pullStartY.current = event.touches[0].clientY;
  };
  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (pullStartY.current === null || !event.touches[0]) return;
    const distance = Math.max(0, event.touches[0].clientY - pullStartY.current);
    setPullDistance(Math.min(distance, 96));
  };
  const onTouchEnd = () => {
    const shouldLoad = pullDistance >= 56 && !pullLoading;
    pullStartY.current = null;
    if (!shouldLoad) { setPullDistance(0); return; }
    setPullLoading(true);
    void loadHistory(3).finally(() => { setPullLoading(false); setPullDistance(0); });
  };
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const previous = prependAnchor.current;
    if (!element || !previous) return;
    prependAnchor.current = null;
    requestAnimationFrame(() => {
      const current = scrollRef.current;
      if (current) current.scrollTop = previous.top + current.scrollHeight - previous.height;
    });
  }, [pages.length, items.length]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !trace.data || trace.isFetching || !items.length) return;
    if (pages.length === 1 && !prependAnchor.current && initialAlignedRevision.current !== revision) {
      initialAlignedRevision.current = revision;
      element.scrollTop = element.scrollHeight;
    }
  }, [trace.data, trace.isFetching, pages.length, items.length, revision]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !live.data?.items.length || !followRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [live.data, items.length]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const resize = () => {
      if (followRef.current) element.scrollTop = element.scrollHeight;
      else updateScrollState();
    };
    window.addEventListener("resize", resize);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => { window.removeEventListener("resize", resize); observer.disconnect(); };
  }, []);
  const grouped = conversation(items);
  return <Card className="border-0 p-0 shadow-none">{trace.error && <p role="alert">{trace.error.message}</p>}{trace.isPending && <p role="status">Loading conversation…</p>}
    <div ref={scrollRef} data-run-trace-scroll aria-label="Run trace" className="-mx-4 h-[min(60rem,calc(100svh-18rem))] min-h-64 w-[calc(100%+2rem)] min-w-0 overflow-y-auto overscroll-contain rounded-none border-0 p-0 dark:border-slate-800 sm:mx-0 sm:h-[min(60rem,calc(100svh-18rem))] sm:w-auto sm:rounded-lg sm:border sm:border-stone-200 sm:p-4" onScroll={updateScrollState} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      {(pullDistance > 0 || pullLoading) && <p data-run-trace-pull role="status" aria-live="polite" className="sticky top-0 z-10 -mb-8 flex h-8 items-center justify-center bg-stone-50/90 text-xs font-medium text-slate-600 backdrop-blur dark:bg-slate-950/90 dark:text-slate-400">{pullLoading ? "Loading older events…" : pullDistance >= 56 ? "Release to load older events" : `Pull to load older events · ${Math.round((pullDistance / 56) * 100)}%`}</p>}
      {!trace.isPending && !grouped.length && <p className="text-sm text-slate-600 dark:text-slate-400">No assistant messages yet.</p>}
      <div data-run-trace className="flex min-h-full min-w-0 flex-col justify-end space-y-4" aria-live={active ? "polite" : undefined}>{grouped.map((item, index) => item.kind === "assistant" ? <article key={item.event.id} className="min-w-0"><EventBody event={item.event} /></article> : <Disclosure key={item.events[0]?.id + ":" + index} className={traceClasses("tool_call")} open={expanded.has(item.events[0]?.id + ":" + index)} onToggle={event => { const key = item.events[0]?.id + ":" + index; const open = event.currentTarget.open; setExpanded(previous => { const next = new Set(previous); open ? next.add(key) : next.delete(key); return next; }); }}><Summary>{item.count} Tool Call{item.count === 1 ? "" : "s"}</Summary><div className="space-y-3">{item.events.map(event => <div key={event.id}><EventBody event={event} /></div>)}</div></Disclosure>)}</div>
    </div>
    {active && <p role="status" className="mt-5 text-sm font-medium"><span aria-hidden="true" className="mr-2 inline-block motion-safe:animate-pulse">●</span>Running…</p>}
  </Card>;
}
