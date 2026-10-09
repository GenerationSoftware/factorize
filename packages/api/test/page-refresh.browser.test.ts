// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobsPage, jobDetailPage, jobRunPage } from "../src/ui";

declare const document: any;
declare const window: any;
const viewer = { email: "owner@example.com" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const job = { id: "job-1", name: "Build", runningCount: 0, concurrencyLimit: 2, enabled: true, triggers: [] };
const run = { id: "run-1", job_id: "job-1", state: "queued", artifact_state: "pending", created_at: "2026-09-18T00:00:00Z" };
const event = (sequence: number) => ({ sequence, type: "assistant_message", title: "Assistant", preview: "Event " + sequence });
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const listeners: [any, string, any][] = [];

function render(html: string, fetcher: any) {
  vi.stubGlobal("fetch", fetcher);
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? "";
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1];
  new Function(script)();
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type: any, listener: any, options: any) => {
      listeners.push([target, type, listener]); add(type, listener, options);
    });
  }
});
afterEach(() => {
  for (const [target, type, listener] of listeners.splice(0)) target.removeEventListener(type, listener);
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("job split Run button", () => {
  function setup(invoke: any = async () => json({ runId: 'created-run' })) {
    const fetcher = vi.fn(async (input: string, init: any) => {
      if (init?.method === 'POST') return invoke(input, init);
      return json(input.startsWith('/api/v1/jobs/') ? job : { items: [], nextCursor: null });
    });
    render(jobDetailPage(viewer, job.id), fetcher);
    return fetcher;
  }

  it("runs immediately without a prompt, prevents duplicate clicks, and navigates to the run", async () => {
    let finish!: (response: Response) => void;
    const fetcher = setup(() => new Promise<Response>(resolve => { finish = resolve; }));
    await flush();
    const dialog = document.querySelector('#manual-run-dialog');
    dialog.showModal = vi.fn();
    document.querySelector('#manual-run-prompt').value = 'Unused draft';
    document.querySelector('#run').click();
    document.querySelector('#run').click();
    expect(dialog.showModal).not.toHaveBeenCalled();
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual(['/api/v1/jobs/job-1/invocations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: expect.any(String),
    }]);
    expect(document.querySelector('#run-options').disabled).toBe(true);
    finish(json({ runId: 'created-run' })); await flush();
    expect(window.location.pathname).toBe('/job-runs/created-run');
  });

  it("opens the prompt modal from the dropdown and submits the entered prompt", async () => {
    const fetcher = setup(); await flush();
    const dialog = document.querySelector('#manual-run-dialog');
    dialog.showModal = vi.fn();
    document.querySelector('#run-options').click();
    expect(document.querySelector('#run-menu').hidden).toBe(false);
    expect(document.querySelector('#run-options').getAttribute('aria-expanded')).toBe('true');
    document.querySelector('#run-with-prompt').click();
    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect(document.querySelector('#run-menu').hidden).toBe(true);
    expect(document.activeElement.id).toBe('manual-run-prompt');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    document.querySelector('#manual-run-prompt').value = 'Review the release';
    document.querySelector('#manual-run-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1].body)).toEqual({ prompt: 'Review the release', idempotencyKey: expect.any(String) });
  });

  it("supports keyboard opening, Escape focus restoration, and outside dismissal", async () => {
    setup(); await flush();
    const button = document.querySelector('#run-options');
    button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement.id).toBe('run-with-prompt');
    document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('#run-menu').hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    button.click(); document.body.click();
    expect(document.querySelector('#run-menu').hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click(); document.querySelector('#toggle').focus();
    expect(document.querySelector('#run-menu').hidden).toBe(true);
  });

  it("shows immediate-run errors and allows a retry", async () => {
    let failed = true;
    const fetcher = setup(async () => failed ? json({ error: 'Queue full' }, 409) : json({ runId: 'retry-run' }));
    await flush(); document.querySelector('#run').click(); await flush();
    expect(document.querySelector('#run-error').hidden).toBe(false);
    expect(document.querySelector('#run-error').textContent).toBe('Queue full');
    expect(document.querySelector('#run').disabled).toBe(false);
    failed = false; document.querySelector('#run').click(); await flush();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
    expect(window.location.pathname).toBe('/job-runs/retry-run');
  });
});

describe("mutation reconciliation", () => {
  it("gives immediate feedback during a controlled 600ms response and navigates only on confirmation",async()=>{
    const fetcher=vi.fn(async(url: string,init: any)=>{
      if(init?.method)return new Promise<Response>(resolve=>setTimeout(()=>resolve(json({runId:'timed-run'})),600));
      return json(url.startsWith('/api/v1/jobs/')?job:{items:[],nextCursor:null});
    });
    render(jobDetailPage(viewer,job.id),fetcher);await flush();
    const start=Date.now();document.querySelector('#run').click();
    expect(Date.now()-start).toBe(0);
    expect(document.querySelector('#run').textContent).toBe('Starting…');
    await vi.advanceTimersByTimeAsync(599);
    expect(document.querySelector('#run').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(Date.now()-start).toBe(600);
    expect(window.location.pathname).toBe('/job-runs/timed-run');
  });
  it("closes the prompt modal immediately and recovers the draft after rejection",async()=>{
    let finish!: (response: Response)=>void;
    const fetcher=vi.fn(async(url: string,init: any)=>{
      if(init?.method)return new Promise<Response>(resolve=>{finish=resolve});
      return json(url.startsWith('/api/v1/jobs/')?job:{items:[],nextCursor:null});
    });
    render(jobDetailPage(viewer,job.id),fetcher);await flush();
    const dialog=document.querySelector('#manual-run-dialog');dialog.showModal=()=>{dialog.open=true};
    document.querySelector('#run-options').click();document.querySelector('#run-with-prompt').click();
    document.querySelector('#manual-run-prompt').value='Keep my input';
    document.querySelector('#manual-run-form').dispatchEvent(new Event('submit',{cancelable:true}));
    expect(dialog.open).toBe(false);
    finish(json({error:'Queue full'},409));await flush();
    document.querySelector('#run-options').click();document.querySelector('#run-with-prompt').click();
    expect(document.querySelector('#manual-run-prompt').value).toBe('Keep my input');
    expect(document.querySelector('#manual-run-error').textContent).toContain('Queue full');
  });
  it("keeps deletion pending through artifact cleanup and only navigates after confirmation",async()=>{
    let finish!: (response: Response)=>void;vi.stubGlobal('confirm',()=>true);
    const fetcher=vi.fn(async(url: string,init: any)=>{
      if(init?.method)return new Promise<Response>(resolve=>{finish=resolve});
      return json(url.startsWith('/api/v1/jobs/')?job:{items:[],nextCursor:null});
    });
    render(jobDetailPage(viewer,job.id),fetcher);await flush();
    const before=window.location.pathname;
    document.querySelector('#delete').click();document.querySelector('#delete').click();
    expect(document.querySelector('#delete').textContent).toBe('Deleting…');
    expect(window.location.pathname).toBe(before);
    expect(fetcher.mock.calls.filter(([,init])=>init?.method)).toHaveLength(1);
    finish(json({deleted:true}));await flush();
    expect(window.location.pathname).toBe('/jobs');
  });

  it("retains Starting feedback across a changed poll and reuses the key after a lost response", async () => {
    let count=0, finish!: (response: Response) => void;
    const fetcher=vi.fn(async (url: string, init: any) => {
      if(init?.method) return new Promise<Response>(resolve=>{finish=resolve});
      return json(url.startsWith('/api/v1/jobs/')?{...job,runningCount:count}:{items:[],nextCursor:null});
    });
    render(jobDetailPage(viewer,job.id),fetcher);await flush();
    document.querySelector('#run').click();
    expect(document.querySelector('#run').textContent).toBe('Starting…');
    expect(document.querySelector('[data-pending-run]').textContent).toContain('Awaiting acceptance');
    const key=JSON.parse(fetcher.mock.calls.find(([,init])=>init?.method)![1].body).idempotencyKey;
    count=1;await vi.advanceTimersByTimeAsync(10000);
    expect(document.querySelector('#run').disabled).toBe(true);
    expect(document.querySelector('#run').textContent).toBe('Starting…');
    document.querySelector('#manual-run-form').dispatchEvent(new Event('submit',{cancelable:true}));
    expect(fetcher.mock.calls.filter(([,init])=>init?.method)).toHaveLength(1);
    finish(json({error:'Wake failed'},500));await flush();
    expect(document.querySelector('#run-error').textContent).toContain('Outcome unknown');
    document.querySelector('#run').click();
    expect(JSON.parse(fetcher.mock.calls.filter(([,init])=>init?.method).at(-1)![1].body).idempotencyKey).toBe(key);
    finish(json({runId:'recovered'}));await flush();
    expect(window.location.pathname).toBe('/job-runs/recovered');
  });

  it.each([409,500])("reconciles an enable rejection (%s) without stale reads undoing the action",async status=>{
    let serverEnabled=true,finishMutation!: (response: Response)=>void,finishRead!: (response: Response)=>void,hold=false;
    const fetcher=vi.fn(async(url: string,init: any)=>{
      if(init?.method)return new Promise<Response>(resolve=>{finishMutation=resolve});
      if(url.startsWith('/api/v1/jobs/')){
        if(hold){hold=false;return new Promise<Response>(resolve=>{finishRead=resolve})}
        return json({...job,enabled:serverEnabled});
      }
      return json({items:[],nextCursor:null});
    });
    render(jobDetailPage(viewer,job.id),fetcher);await flush();
    hold=true;await vi.advanceTimersByTimeAsync(10000);
    document.querySelector('#toggle').click();
    expect(document.querySelector('[data-enabled-badge]').textContent).toBe('Disabled');
    expect(document.querySelector('#toggle').textContent).toBe('Disabling…');
    serverEnabled=status===409;
    finishMutation(json({error:'Rejected'},status));await flush();
    expect(document.querySelector('[data-enabled-badge]').textContent).toBe(status===409?'Enabled':'Disabled');
    finishRead(json(job));await flush();
    expect(document.querySelector('[data-enabled-badge]').textContent).toBe(serverEnabled?'Enabled':'Disabled');
    expect(fetcher.mock.calls.filter(([url,init])=>url.startsWith('/api/v1/jobs/')&&!init?.method).length).toBeGreaterThanOrEqual(3);
  });

  it("confirms enable directly from the mutation response before reconciliation",async()=>{
    let finish!: (response: Response)=>void,hold=false;
    const fetcher=vi.fn(async(url: string,init: any)=>{
      if(init?.method)return new Promise<Response>(resolve=>{finish=resolve});
      if(hold)return new Promise<Response>(()=>{});
      return json(url.startsWith('/api/v1/jobs/')?job:{items:[],nextCursor:null});
    });
    render(jobDetailPage(viewer,job.id),fetcher);await flush();
    document.querySelector('#toggle').click();hold=true;
    finish(json({id:job.id,enabled:false}));await flush();
    expect(document.querySelector('[data-enabled-badge]').textContent).toBe('Disabled');
    expect(document.querySelector('#toggle').textContent).toBe('Enable');
  });

  it.each(['queued','starting','running','blocked','stopping','succeeded','failed','stopped'])("offers stop only for API-supported %s state",async state=>{
    let finish!: (response: Response)=>void;
    vi.stubGlobal('confirm',()=>true);
    const fetcher=vi.fn(async(url: string,init: any)=>{
      if(init?.method)return new Promise<Response>(resolve=>{finish=resolve});
      if(url.includes('/trace?'))return json({items:[],nextCursor:null});
      return json(url.startsWith('/api/v1/jobs/')?job:{...run,state});
    });
    render(jobRunPage(viewer,run.id),fetcher);await flush();
    const button=document.querySelector('#kill-run');
    expect(Boolean(button)).toBe(['starting','running','blocked'].includes(state));
    if(button){
      button.click();button.click();
      expect(button.textContent).toBe('Stopping…');
      expect(fetcher.mock.calls.filter(([,init])=>init?.method)).toHaveLength(1);
      expect(document.querySelector('[data-run-state]').textContent).toBe(state);
      finish(json({id:run.id,state:'stopping'}));await flush();
      expect(document.querySelector('#run-detail h1')).not.toBeNull();
    }
  });
});

describe("lifecycle page refresh", () => {
  it("discovers jobs while idle, updates running counts, and preserves unchanged DOM", async () => {
    let jobs: any[] = [];
    const fetcher = vi.fn(async () => json(jobs));
    render(jobsPage(viewer), fetcher); await flush();
    expect(document.querySelector('#jobs').textContent).toContain('No jobs yet');
    jobs = [{ ...job, runningCount: 1 }];
    await vi.advanceTimersByTimeAsync(10000);
    expect(document.querySelector('#jobs').textContent).toContain('1/2 Running');
    const link = document.querySelector('#jobs a'); link.focus();
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector('#jobs a')).toBe(link);
    jobs = [job]; await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector('#jobs').textContent).toContain('0/2 Running');
    expect(document.activeElement.getAttribute('href')).toBe('/jobs/job-1');
  });

  it("pauses when hidden, refreshes on return, and serializes slow requests", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
    render(jobsPage(viewer), fetcher);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(json([job])); await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    resolve(json([job])); await flush();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetcher).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event('pagehide'));
    resolve(json([job])); await flush(); await vi.advanceTimersByTimeAsync(30000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event('pageshow'));
    expect(fetcher).toHaveBeenCalledTimes(4);
    resolve(json([job])); await flush();
  });

  it("backs off failures and keeps the last good page until recovery", async () => {
    let failed = false;
    const fetcher = vi.fn(async () => failed ? json({ error: 'Unavailable' }, 503) : json([job]));
    render(jobsPage(viewer), fetcher); await flush(); failed = true;
    await vi.advanceTimersByTimeAsync(10000);
    expect(document.querySelector('#jobs').textContent).toContain('Build');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(9999);
    expect(fetcher).toHaveBeenCalledTimes(3);
    failed = false; await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("refreshes the selected runs page without resetting disclosures or a manual prompt", async () => {
    let state = 'running';
    const fetcher = vi.fn(async (input: string) => {
      if (input.startsWith('/api/v1/jobs/')) return json({ ...job, runningCount: state === 'running' ? 1 : 0 });
      return json({ items: [{ ...run, id: input.includes('cursor=older') ? 'old-run' : 'new-run', state }], nextCursor: input.includes('cursor=older') ? null : 'older' });
    });
    render(jobDetailPage(viewer, job.id), fetcher); await flush();
    document.querySelector('#manual-run-prompt').value = 'Keep this draft';
    document.querySelector('[data-run-page="next"]').click(); await flush();
    expect(document.querySelector('[data-job-runs-list] a').getAttribute('href')).toContain('old-run');
    document.querySelector('#job-detail details').open = true;
    state = 'succeeded'; await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector('[data-job-runs-pagination]').textContent).toContain('Page 2');
    expect(document.querySelector('[data-job-runs-list]').textContent).toContain('succeeded');
    expect(document.querySelector('#job-detail details').open).toBe(true);
    expect(document.querySelector('#manual-run-prompt').value).toBe('Keep this draft');
    expect(document.querySelector('#job-detail').textContent).toContain('0/2 Running');
    expect(fetcher.mock.calls.at(-1)![0]).toContain('cursor=older');
  });

  it("discovers a newly queued run on an empty job", async () => {
    let items: any[] = [];
    const fetcher = vi.fn(async (input: string) => json(input.startsWith('/api/v1/jobs/') ? job : { items, nextCursor: null }));
    render(jobDetailPage(viewer, job.id), fetcher); await flush();
    expect(document.querySelector('[data-job-runs-list]').textContent).toContain('No runs yet');
    items = [run]; await vi.advanceTimersByTimeAsync(10000);
    expect(document.querySelector('[data-job-runs-list]').textContent).toContain('queued');
    items = [{ ...run, state: 'running' }]; await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector('[data-job-runs-list]').textContent).toContain('running');
  });

  it.each(['failed', 'stopped', 'canceled', 'cancelled'])("recovers initial run errors and treats %s as terminal", async state => {
    let failed = true;
    const fetcher = vi.fn(async (input: string) => {
      if (failed) return json({ error: 'Unavailable' }, 503);
      if (input.includes('/trace?')) return json({ items: [], nextCursor: null });
      return json(input.startsWith('/api/v1/jobs/') ? job : { ...run, state, artifact_state: 'failed' });
    });
    render(jobRunPage(viewer, run.id), fetcher); await flush();
    expect(document.querySelector('#run-detail').textContent).toContain('Unavailable');
    failed = false; await vi.advanceTimersByTimeAsync(5000);
    expect(document.querySelector('[data-run-state]').textContent).toBe(state);
    expect(document.querySelector('#kill-run')).toBeNull();
    const calls = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });

  it("updates run lifecycle UI, appends bounded trace pages, and stops after finalization", async () => {
    let current = { ...run, name: "Release <widgets>", run_name: "Legacy name", issue_title: "Issue title" };
    let sequence = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/trace?')) return json({ items: [event(++sequence)], nextCursor: null });
      if (input.startsWith('/api/v1/jobs/')) return json(job);
      return json(current);
    });
    render(jobRunPage(viewer, run.id), fetcher); await flush();
    expect(document.querySelector('#run-detail h1').textContent).toBe(current.name);
    expect(document.querySelector('[aria-current="page"]').textContent).toBe(current.name);
    expect(document.title).toBe(current.name + ' — Factorize');
    const trace = document.querySelector('[data-run-trace]');
    expect(trace.classList.contains('trace-list')).toBe(true);
    expect(trace.classList.contains('trace-at-end')).toBe(true);
    const first = trace.firstElementChild;
    document.querySelector('[data-run-prompt-details]').open = true;
    for (const state of ['starting', 'running', 'blocked', 'stopping', 'succeeded']) {
      current = { ...current, state, artifact_state: state === 'succeeded' ? 'stored' : 'collecting' };
      await vi.advanceTimersByTimeAsync(3000);
      expect(document.querySelector('[data-run-state]').textContent).toBe(state);
      expect(document.querySelector('#run-detail').classList.contains('trace-running')).toBe(state === 'running');
      expect(document.querySelector('#run-detail h1').textContent).toBe(current.name);
      expect(document.title).toBe(current.name + ' — Factorize');
    }
    expect(trace.firstElementChild).not.toBe(first);
    expect(trace.children).toHaveLength(1);
    expect(document.querySelector('[data-run-prompt-details]').open).toBe(true);
    expect(document.querySelector('#kill-run')).toBeNull();
    expect(document.querySelector('[data-run-live]').hidden).toBe(true);
    expect(document.querySelector('[data-run-artifact]').textContent).toContain('stored');
    const calls = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetcher).toHaveBeenCalledTimes(calls);
    const traceUrls = fetcher.mock.calls.map(([url]) => url).filter(url => url.includes('/trace?'));
    expect(traceUrls).toEqual([0, 1, 2, 3, 4, 0].map(after => '/api/v1/runs/run-1/trace?after=' + after + '&limit=100'));
  });

  it("waits for terminal artifacts and serializes Load more with automatic trace refresh", async () => {
    let current = { ...run, state: 'succeeded', artifact_state: 'collecting' };
    let finishTrace!: (response: Response) => void;
    let traces = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/trace?')) {
        if (++traces === 1) return json({ items: [event(1)], nextCursor: 1 });
        return new Promise<Response>(resolve => { finishTrace = resolve; });
      }
      return json(input.startsWith('/api/v1/jobs/') ? job : current);
    });
    render(jobRunPage(viewer, run.id), fetcher); await flush();
    document.querySelector('[data-trace-more]').click(); await flush();
    current = { ...current, artifact_state: 'stored' };
    await vi.advanceTimersByTimeAsync(10000);
    expect(traces).toBe(2);
    finishTrace(json({ items: [event(2)], nextCursor: 2 })); await flush();
    expect(traces).toBe(3);
    finishTrace(json({ items: [event(3)], nextCursor: 3 })); await flush();
    expect(document.querySelector('[data-run-trace]').children).toHaveLength(3);
    expect(document.querySelector('[data-trace-more]').classList.contains('hidden')).toBe(false);
    expect(document.querySelector('[data-run-trace]').classList.contains('trace-at-end')).toBe(false);
    await vi.advanceTimersByTimeAsync(30000);
    expect(traces).toBe(3);
  });
  it.each(['codex', 'claude', 'pi'])("shows %s live tools and replaces a reconciled or rolled-back projection without duplicates", async provider => {
    let current: any = { ...run, state: 'running', agent_kind: provider, trace_sources: { primary: { provider, kind: provider === 'pi' ? 'native_session' : 'execution_stream' } }, trace_generation: 'file-1', trace_projection: null };
    let items = [{ sequence: 1, id: 'call', type: 'tool_call', title: 'shell', preview: 'live command', display: {} }];
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/trace?')) { const after = Number(new URL(input, 'https://app').searchParams.get('after')); return json({ items: items.filter(item => item.sequence > after), nextCursor: null }); }
      return json(input.startsWith('/api/v1/jobs/') ? job : current);
    });
    render(jobRunPage(viewer, run.id), fetcher); await flush();
    expect(document.querySelector('[data-run-state]').textContent).toBe('running');
    expect(document.querySelector('[data-run-trace]').textContent).toContain('live command');
    expect(document.querySelector('[data-run-artifact]').textContent).toContain(provider === 'pi' ? 'Native session' : 'Execution stream');
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector('[data-run-trace]').children).toHaveLength(1);
    items = [{ sequence: 1, id: 'reconciled', type: 'tool_call', title: 'shell', preview: 'terminal command', display: {} }];
    current = { ...current, state: 'succeeded', artifact_state: 'collecting', trace_projection: { source_kind: current.trace_sources.primary.kind, artifact_sha256: 'stream', updated_at: 'one' } };
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector('[data-run-trace]').children).toHaveLength(1);
    expect(document.querySelector('[data-run-trace]').textContent).toContain('terminal command');
    expect(document.querySelector('[data-run-trace]').textContent).not.toContain('live command');
    items = [{ sequence: 1, id: 'native', type: 'tool_call', title: 'apply_patch', preview: 'recovered native command', display: {} }];
    current = { ...current, artifact_state: 'stored', trace_projection: { source_kind: 'native_session', artifact_sha256: 'native', updated_at: 'two' } };
    await vi.advanceTimersByTimeAsync(10000);
    expect(document.querySelector('[data-run-trace]').children).toHaveLength(1);
    expect(document.querySelector('[data-run-trace]').textContent).toContain('recovered native command');
    expect(document.querySelector('[data-run-artifact]').textContent).toContain('Native session');
    if (provider !== 'pi') expect(document.querySelector('[data-run-artifact]').textContent).toContain('Native fallback');
  });

});

describe("persistent trace activity", () => {
  it.each(['succeeded', 'failed', 'canceled'])("stays at the trace end between events and disappears on %s", async terminal => {
    let current = { ...run, state: 'running', artifact_state: 'stored' };
    let items = [event(1)];
    let resolveTrace: ((response: Response) => void) | undefined;
    let pause = false;
    render(jobRunPage(viewer, run.id), vi.fn(async (input: string) => {
      if (input.includes('/trace?')) {
        if (pause) return new Promise<Response>(resolve => { resolveTrace = resolve; });
        const after = Number(new URL(input, 'https://app').searchParams.get('after'));
        return json({ items: items.filter(item => item.sequence > after), nextCursor: null });
      }
      return json(input.startsWith('/api/v1/jobs/') ? job : current);
    }));
    await flush();
    const trace = document.querySelector('[data-run-trace]');
    const activity = document.querySelector('[data-trace-activity]');
    expect(activity.hidden).toBe(false);
    expect(trace.nextElementSibling).toBe(activity);
    expect(activity.textContent).toBe('Thinking…');
    await vi.advanceTimersByTimeAsync(3000);
    expect(trace.children).toHaveLength(1);
    expect(activity.hidden).toBe(false);
    pause = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(activity.hidden).toBe(false);
    items.push(event(2));
    resolveTrace!(json({ items: [event(2)], nextCursor: null }));
    await flush();
    expect(trace.children).toHaveLength(2);
    expect(trace.nextElementSibling).toBe(activity);
    expect(activity.hidden).toBe(false);
    pause = false;
    current = { ...current, state: terminal };
    await vi.advanceTimersByTimeAsync(3000);
    expect(activity.hidden).toBe(true);
  });

  it.each(['queued', 'starting', 'blocked', 'stopping', 'succeeded', 'failed', 'canceled'])("does not show activity when opening a %s run", async state => {
    render(jobRunPage(viewer, run.id), vi.fn(async (input: string) => {
      if (input.includes('/trace?')) return json({ items: [event(1)], nextCursor: null });
      return json(input.startsWith('/api/v1/jobs/') ? job : { ...run, state });
    }));
    await flush();
    expect(document.querySelector('[data-trace-activity]').hidden).toBe(true);
  });

  it("shows activity for a running run with no trace events yet", async () => {
    render(jobRunPage(viewer, run.id), vi.fn(async (input: string) => {
      if (input.includes('/trace?')) return json({ items: [], nextCursor: null });
      return json(input.startsWith('/api/v1/jobs/') ? job : { ...run, state: 'running' });
    }));
    await flush();
    expect(document.querySelector('[data-run-trace]').children).toHaveLength(0);
    expect(document.querySelector('[data-trace-activity]').hidden).toBe(false);
  });
});
