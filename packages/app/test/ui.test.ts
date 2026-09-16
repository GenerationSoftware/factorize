import { describe, expect, it } from "vitest";
import { flowDetailPage, flowPage, flowWebhooksPage, flowsPage, jobDetailPage, jobPage, jobsPage, jobRunPage, landingPage, runDetailPage, settingsPage } from "../src/ui";

describe("pages", () => {
  const expectInlineScriptsToParse = (html: string) => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    expect(scripts.length).toBeGreaterThan(0);
    scripts.forEach((script) => expect(() => new Function(script)).not.toThrow());
  };

  it("renders the simple landing page and theme control", () => {
    const html = landingPage(null);
    expect(html).toContain("No-code Software Factories");
    expect(html).toContain("Create a multiplayer software factory with");
    expect(html).toContain("Factorize: Software Factories for Everybody");
    expect(html).toContain('href="https://linear.app/" target="_blank"');
    expect(html).toContain('href="https://exe.dev/" target="_blank"');
    expect(html).toContain('href="https://herdr.dev/" target="_blank"');
    expect(html).toContain("Choose when to fully automate");
    expect(html).toContain("Issues are routed to agents");
    expect(html).toContain('href="/jobs/new"');
    expect(html).toContain('href="https://github.com/asselstine/factorize" target="_blank"');
    expect(html).toContain("Host it Yourself");
    expect(html).toContain("View on GitHub");
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain("dark:bg-slate-950");
  });

  it("renders all three flow configuration sections", () => {
    const html = flowPage({ email: "owner@example.com" });
    expect(html).toContain(">Source</h2>");
    expect(html).toContain("PR leaves merge queue with conflicts");
    expect(html).toContain("Flow config");
    expect(html).toContain("Flow ID");
    expect(html).toContain("slugFor");
    expect(html).toContain("Exe.dev config");
    expect(html).toContain("Agent config");
    expect(html).toContain("Context template");
    expect(html).toContain('id="reset-context-template"');
    expect(html).toContain("Reset this context template");
    expect(html).not.toContain('name="workspaceName"');
    expect(html).toContain('class="field"');
    expect(html).toContain("Issue matching rules");
    expect(html).toContain("Add rule");
    expect(html).toContain("Agent launch arguments");
    expect(html).toContain('class="min-w-0 w-full"');
    expect(html).toContain('id="test-exe"');
    expect(html).toContain('id="exe-connection"');
    expect(html).toContain("Connections save an SSH destination and its restricted HTTPS token");
    expect(html).toContain("This is chosen per flow");
    expect(html).toContain("/home/exedev/projects/{{{flowId}}}");
    expect(html).toContain("as a Mustache variable");
    expect(html).toContain("Test Connection");
    expect(html).toContain('id="exe-test-status"');
    expect(html).toContain("Connection successful");
    expect(html).toContain("Connection failed");
    expect(html).toContain("r.ok&&body.ok");
    expect(html).toContain("Cloudflare Tail credentials");
    expect(html).toContain("Generate new secret");
    expect(html).toContain("FACTORIZE_TAIL_SECRET");
    expect(html).toContain("navigator.clipboard.writeText");
    expect(html).toContain("crypto.getRandomValues(new Uint8Array(32))");
    expect(html).toContain("tailSigningSecret");
  });

  it("renders paginated agent runs with links to run and webhook pages", () => {
    const html = flowDetailPage({ email: "owner@example.com" }, "flow-1");
    expect(html).toContain("Agent runs");
    expect(html).toContain("?view=runs&page=");
    expect(html).toContain("/webhooks");
    expect(html).toContain("/runs/");
    expect(html).toContain("Edit Flow");
    expect(html).toContain("issueLink");
    expect(html).toContain("issue_title");
    expect(html).toContain("esc(run.issue_id)+(run.issue_title?': '+esc(run.issue_title):'')");
    expect(html).toContain("Select a run to inspect its details and full output.");
    expect(html).not.toContain('<details class="border-t');
    expectInlineScriptsToParse(html);
  });

  it("renders webhook activity on its own paginated page", () => {
    const html = flowWebhooksPage({ email: "owner@example.com" }, "flow-1");
    expect(html).toContain("Webhook activity");
    expect(html).toContain("?view=events&page=");
    expect(html).toContain("whether they queued an agent");
    expectInlineScriptsToParse(html);
  });

  it("renders an agent run page", () => {
    const html = runDetailPage({ email: "owner@example.com" }, "run-1");
    expect(html).toContain("/api/runs/");
    expect(html).toContain("Rendered prompt");
    expect(html).toContain("Harness launch request");
    expect(html).toContain("Prompt delivery request");
    expect(html).toContain("Full agent output");
    expectInlineScriptsToParse(html);
  });

  it("renders flow status and active agent capacity without trigger details", () => {
    const html = flowsPage({ email: "owner@example.com" });
    expect(html).toContain("active_agents");
    expect(html).toContain("bg-green-500");
    expect(html).toContain("bg-blue-500");
    expect(html).toContain("bg-red-500");
    expect(html).toContain("concurrent agents");
    expect(html).not.toContain("filter_type+' trigger'");
    expectInlineScriptsToParse(html);
  });

  it("escapes profile data", () => {
    const html = landingPage({ email: '<script>alert("x")</script>@example.com' });
    expect(html).not.toContain('<script>alert("x")</script>@example.com');
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps Settings in the accessible profile menu and Jobs in primary navigation", () => {
    const html = jobsPage({ email: "owner@example.com" });
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    const profileMenu = header.match(/<details[\s\S]*?<\/details>/)?.[0] ?? "";
    expect(header).toContain('href="/jobs" data-navigation="jobs"');
    expect(header).not.toMatch(/<a href="\/settings"[^>]*>Settings<\/a><details/);
    expect(profileMenu).toContain('aria-label="Open profile menu"');
    expect(profileMenu).toContain('h-11 w-11');
    expect(profileMenu).toContain('href="/settings" data-navigation="settings"');
    expect(profileMenu.indexOf("owner@example.com")).toBeLessThan(profileMenu.indexOf(">Settings</a>"));
    expect(profileMenu.indexOf(">Settings</a>")).toBeLessThan(profileMenu.indexOf(">Log out</button>"));
    expect(profileMenu).toContain("border-t");
    expect(html).toContain("setAttribute('aria-current','page')");
  });

  it("edits complete Linear AND rule sets in the current job editor", () => {
    const html = jobPage({ email: "owner@example.com" });
    expect(html).toContain('id="linear-rules"');
    expect(html).toContain('id="add-linear-rule"');
    expect(html).toContain("status:'Status',label:'Label',assignee:'Assignee',creator:'Creator',owner:'Owner'");
    expect(html).toContain("matchRules:readLinearRules()");
    expect(html).toContain("(c.matchRules?.length?c.matchRules:");
    expect(html).not.toContain("const legacyJobPage");
    expectInlineScriptsToParse(html);
  });

  it("combines trigger selection and addition into one accessible control", () => {
    const html = jobPage({ email: "owner@example.com" });
    expect(html).toContain('<label class="sr-only" for="add-trigger">Add a trigger</label>');
    expect(html).toContain('<select id="add-trigger" class="field disabled:cursor-wait disabled:opacity-60" disabled>');
    expect(html).toContain("Loading trigger types…");
    expect(html).toContain("addTrigger.options[0].textContent='Add trigger…'");
    expect(html).toContain("$('#add-trigger').onchange=");
    expect(html).not.toContain('id="add-trigger-kind"');
    expect(html).not.toContain('<button id="add-trigger"');
    expectInlineScriptsToParse(html);
  });

  it("aligns Settings with the Jobs page width and gutters", () => {
    const settings = settingsPage({ email: "owner@example.com" });
    expect(settings).toContain('<main class="mx-auto max-w-6xl px-5 py-12 lg:px-8">');
    expect(settings).not.toContain('<main class="mx-auto max-w-4xl');
  });

  it("renders the complete jobs dashboard experience", () => {
    const list = jobsPage({ email: "owner@example.com" });
    const editor = jobPage({ email: "owner@example.com" }, "job-1");
    const detail = jobDetailPage({ email: "owner@example.com" }, "job-1");
    const run = jobRunPage({ email: "owner@example.com" }, "run-1");
    const settings = settingsPage({ email: "owner@example.com" });
    expect(list).toContain("Manual only");
    expect(editor).toContain("Add trigger");
    expect(editor).toContain('id="trigger-rows"');
    expect(editor).toContain("Context slug");
    expect(editor).toContain("Custom webhook");
    expect(editor).toContain("Job lifecycle");
    expect(editor).toContain("Test handler");
    expect(editor).toContain("data-up");
    expect(editor).toContain("multiple size=\"4\"");
    expect(editor).toContain("Available context");
    expect(editor).not.toContain("Additional triggers (JSON array)");
    expect(editor).not.toContain('name="triggerKind"');
    expect(editor).toContain("/api/schedules/preview");
    expect(editor).toContain("America/New_York");
    expect(editor).toContain("Credentials are managed only");
    expect(editor).toContain("Cloudflare Tail");
    expect(detail).toContain("Run now");
    expect(run).toContain("destination_url");
    expect(run).toContain("caps.includes('output')");
    expect(settings).toContain("Connect every provider used by your Jobs");
    expect(settings).toContain("Linear");
    expect(settings).toContain("GitHub App");
    expect(settings).toContain("Exe.dev execution");
    expect(settings).toContain("Amp cloud execution");
    expect(settings).toContain("Not connected");
    expect(settings).toContain("Action required");
    expect(settings).toContain("Unavailable");
    expect(settings).toContain("write-only");
    for (const [name, html] of Object.entries({ list, editor, detail, run, settings })) {
      try { expectInlineScriptsToParse(html); } catch (error) { throw new Error(`${name}: ${error}`); }
    }
  });
});
