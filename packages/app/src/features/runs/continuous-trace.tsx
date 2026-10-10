import { traceClasses } from "./event-body";
import { Disclosure, Summary, Button, Card } from "../../shared/ui";
import { EventBody } from "./event-body";
import { useRef, useState, useEffect } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer, defaultRangeExtractor } from "@tanstack/react-virtual";
import { api } from "factorize-api-client";
import { messageOf } from "../auth/session";
export function ContinuousTrace({ runId, revision, active, onReset }: { runId: string; revision: string; active: boolean; onReset: (revision: string) => void }) {
  const cache = useQueryClient();
  const [focused, setFocused] = useState<number | null>(null), [selection, setSelection] = useState<number[]>([]);
  const container = useRef<HTMLDivElement>(null), [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const paginationStarted = useRef(false);
  const trace = useInfiniteQuery({ queryKey: ["runs", runId, "continuous-trace", revision], initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => { const { data, error } = await api.GET("/api/v1/runs/{runId}/trace-pages", { signal, params: { path: { runId }, query: { after: pageParam, revision, limit: 200 } } }); if (!data || error) throw new Error(messageOf(error)); return data; },
    enabled: !!revision, getNextPageParam: page => page.reset ? undefined : page.nextCursor ?? undefined,
    staleTime: Infinity, retry: 1,
  });
  const lastParam = trace.data?.pageParams.at(-1);
  const lastAfter = typeof lastParam === "number" ? lastParam : 0;
  const live = useQuery({ queryKey: ["runs", runId, "continuous-tail", revision, lastAfter], enabled: active && !!trace.data && !trace.hasNextPage && !trace.isFetching,
    queryFn: async ({ signal }) => { const { data, error } = await api.GET("/api/v1/runs/{runId}/trace-pages", { signal, params: { path: { runId }, query: { after: lastAfter, revision, limit: 200 } } }); if (!data || error) throw new Error(messageOf(error)); return data; },
    refetchIntervalInBackground: false, refetchInterval: query => query.state.error ? 10_000 : 2_000, retry: 1,
  });
  useEffect(() => { const changed = live.data?.reset ? live.data : trace.data?.pages.find(page => page.reset || page.revision !== revision); if (changed) onReset(changed.revision); }, [live.data, trace.data, revision, onReset]);
  useEffect(() => { if (live.data && !live.data.reset && live.data.revision === revision) cache.setQueryData(trace.data ? ["runs", runId, "continuous-trace", revision] : [], (previous: typeof trace.data) => previous ? { ...previous, pages: previous.pages.map((page, index) => index === previous.pages.length - 1 ? live.data! : page) } : previous); }, [live.data, cache, runId, revision]);
  const items = trace.data?.pages.filter(page => page.revision === revision && !page.reset).flatMap(page => page.items) ?? [];
  const latestAssistant = [...items].reverse().find(event => event.type === "assistant_message");
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const changed = () => { paginationStarted.current = true; };
    element.addEventListener("scroll", changed, { passive: true });
    return () => element.removeEventListener("scroll", changed);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (paginationStarted.current && trace.hasNextPage && !trace.isFetching) void trace.fetchNextPage();
    }, 100);
    return () => window.clearInterval(timer);
  }, [trace.hasNextPage, trace.isFetching, trace.fetchNextPage]);
  useEffect(() => {
    const changed = () => {
      const current = window.getSelection();
      const indices = current && !current.isCollapsed ? [current.anchorNode, current.focusNode].flatMap(node => {
        const element = node instanceof Element ? node : node?.parentElement;
        const row = element?.closest<HTMLElement>("li[data-index]");
        return row && container.current?.contains(row) ? [Number(row.dataset.index)] : [];
      }) : [];
      setSelection(previous => JSON.stringify(previous) === JSON.stringify(indices) ? previous : indices);
    };
    document.addEventListener("selectionchange", changed); return () => document.removeEventListener("selectionchange", changed);
  }, []);
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => container.current, estimateSize: () => 70, overscan: 8, rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...selection, ...(focused === null ? [] : [focused])])].filter(index => index >= 0 && index < items.length).sort((a, b) => a - b), getItemKey: index => `${revision}:${items[index].sequence}:${items[index].id}` });
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    if ((virtualItems.at(-1)?.index ?? -1) < items.length - 8 || !trace.hasNextPage || trace.isFetching) return;
    void trace.fetchNextPage();
  }, [virtualItems, items.length, trace.hasNextPage, trace.isFetching, trace.fetchNextPage]);
  useEffect(() => {
    if (!trace.hasNextPage || trace.isFetching) return;
    const timer = window.setTimeout(() => void trace.fetchNextPage(), 100);
    return () => window.clearTimeout(timer);
  }, [trace.hasNextPage, trace.isFetching, trace.fetchNextPage]);
  return <Card>{trace.error && <p role="alert">{trace.error.message}</p>}{trace.isPending && <p role="status">Loading trace…</p>}
    <h3 className="mt-4 text-lg font-semibold">Status</h3>
    {latestAssistant ? <div className="mt-2 min-w-0 rounded-lg border border-stone-200 p-3 dark:border-slate-700"><EventBody event={latestAssistant} /></div> : <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">No assistant message yet.</p>}
    <h3 className="mt-6 text-lg font-semibold">Full trace</h3>
    {!trace.isPending && !items.length && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">No trace events yet.</p>}
    <div ref={container} onFocusCapture={e => { const row = (e.target as HTMLElement).closest<HTMLElement>("li[data-index]"); setFocused(row ? Number(row.dataset.index) : null); }} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(null); }} tabIndex={0} role="region" aria-label="Full trace" className="mt-2 h-[65vh] min-w-0 max-w-full overflow-auto border p-3">
      <ol className="relative" style={{ height: virtualizer.getTotalSize() }} aria-label="Trace events">{virtualItems.map(row => {
        const event = items[row.index], key = `${revision}:${event.sequence}:${event.id}`;
        return <li key={key} data-index={row.index} ref={virtualizer.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)` }} aria-posinset={row.index + 1} aria-setsize={items.length}>
          <Disclosure className={traceClasses(event.type)} open={expanded.has(key)} onToggle={e => { const open = e.currentTarget.open; setExpanded(previous => { const next = new Set(previous); if (open) next.add(key); else next.delete(key); return next; }); }}><Summary>{event.title} · {event.type}</Summary><EventBody event={event} /></Disclosure>
        </li>;
      })}</ol>
    </div><p role="status">{items.length} events loaded{trace.isFetching ? " · Updating…" : ""}</p>
    {trace.hasNextPage && <Button disabled={trace.isFetching} onClick={() => void trace.fetchNextPage()}>Load more trace events</Button>}
  </Card>;
}
