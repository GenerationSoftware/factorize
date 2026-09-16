import { describe, expect, it } from "vitest";
import { apiKeysSettingsPage, jobDetailPage, jobPage, jobsPage, jobRunPage, landingPage, settingsPage } from "../src/ui";

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
    expect(html).toContain("request('/api/job-trigger-availability')");
    expect(html).toContain("filter(([kind])=>availability[kind])");
    expect(html).toContain("window.addEventListener('focus'");
    expect(html).toContain("$('#add-trigger').onchange=");
    expect(html).not.toContain('id="add-trigger-kind"');
    expect(html).not.toContain('<button id="add-trigger"');
    expectInlineScriptsToParse(html);
  });

  it("organizes create and edit job fields into the same four-step sequence", () => {
    for (const html of [jobPage({ email: "owner@example.com" }), jobPage({ email: "owner@example.com" }, "job-1")]) {
      const basics = html.indexOf('id="job-basics-title"');
      const triggers = html.indexOf('id="job-triggers-title"');
      const prompt = html.indexOf('id="job-prompt-title"');
      const target = html.indexOf('id="job-target-title"');
      expect(basics).toBeGreaterThan(-1);
      expect(basics).toBeLessThan(triggers);
      expect(triggers).toBeLessThan(prompt);
      expect(prompt).toBeLessThan(target);
      expect(html).toContain("Name this job and set how many runs it can process at once.");
      expect(html).toContain("Choose the events that start this job and expose prompt context.");
      expect(html).toContain("Write the instructions for each run using context supplied by your triggers.");
      expect(html).toContain("Select the connected environment that will run this job.");
    }
  });

  it("renders accessible icon actions for editing and removing triggers", () => {
    const editor = jobPage({ email: "owner@example.com" }, "job-1");
    expect(editor).toContain('aria-label="Edit trigger" title="Edit trigger"');
    expect(editor).toContain('aria-label="Remove trigger" title="Remove trigger"');
    expect(editor).toContain('focus-visible:ring-factorize-500');
    expect(editor).toContain('focus-visible:ring-red-500');
    expect(editor).toContain('<svg aria-hidden="true"');
    expect(editor).not.toContain('>Edit</button>');
  });

  it("aligns Settings with the Jobs page width and gutters", () => {
    const settings = settingsPage({ email: "owner@example.com" });
    expect(settings).toContain('<main class="mx-auto max-w-6xl px-5 py-12 lg:px-8">');
    expect(settings).not.toContain('<main class="mx-auto max-w-4xl');
  });

  it("renders accessible settings subpage navigation", () => {
    const integrations = settingsPage({ email: "owner@example.com" });
    const apiKeys = apiKeysSettingsPage({ email: "owner@example.com" });
    expect(integrations).toContain('nav aria-label="Settings"');
    expect(integrations).toContain('href="/settings/integrations" aria-current="page"');
    expect(integrations).toContain('href="/settings/api-keys"');
    expect(apiKeys).toContain('href="/settings/api-keys" aria-current="page"');
    expect(apiKeys).toContain("Authorized clients");
    expect(apiKeys).toContain("Access Tokens");
    expect(apiKeys).toContain("Read only");
    expect(apiKeys).toContain("Read and write");
    expect(apiKeys).toContain("7 days");
    expect(apiKeys).toContain("90 days");
    expect(apiKeys).toContain("cannot be retrieved again");
    expect(apiKeys).toContain("Authorization: Bearer &lt;token&gt;");
    expect(apiKeys).toContain("All of its tokens will stop working immediately");
    expect(apiKeys).toContain("/api/access-tokens");
    expectInlineScriptsToParse(apiKeys);
  });

  it("separates available providers from installed integration management", () => {
    const settings = settingsPage({ email: "owner@example.com" });
    expect(settings.indexOf("Available integrations")).toBeLessThan(settings.indexOf("Installed integrations"));
    expect(settings).toContain('id="installed-loading"');
    expect(settings).toContain('id="installed-empty"');
    expect(settings).toContain('data-open-setup="exe"');
    expect(settings).toContain('aria-haspopup="dialog"');
    expect(settings).toContain('<dialog id="linear-setup"');
    expect(settings).toContain('<dialog id="github-setup"');
    expect(settings).toContain('<dialog id="tail-setup"');
    expect(settings).toContain("+' installed'");
    expect(settings).toContain("/api/connections/cloudflare-tail");
    expect(settings).toContain('data-disconnect-tail=');
    expect(settings).toContain('data-disconnect-github=');
    expect(settings).toContain("Reconnect");
    expect(settings).toContain("Configure");
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
    expect(editor).not.toContain("Custom webhook");
    expect(editor).toContain("Job lifecycle");
    expect(editor).toContain("Test handler");
    expect(editor).not.toContain("data-up");
    expect(editor).not.toContain("data-down");
    expect(editor).not.toContain("Order rows");
    expect(editor).toContain("multiple size=\"4\"");
    expect(editor).toContain("Available context");
    expect(editor).toContain('role="listbox"');
    expect(editor).toContain("contextCatalog");
    expect(editor).toContain("e.key==='Tab'");
    expect(editor).toContain("e.key==='ArrowDown'");
    expect(editor).toContain("e.key==='Escape'");
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
    expect(settings).toContain("Connect Exe.dev");
    expect(settings).toContain("Connect Amp");
    expect(settings).toContain("No integrations installed");
    expect(settings).toContain("Action required");
    expect(settings).toContain("Unavailable");
    expect(settings).toContain("write-only");
    for (const [name, html] of Object.entries({ list, editor, detail, run, settings })) {
      try { expectInlineScriptsToParse(html); } catch (error) { throw new Error(`${name}: ${error}`); }
    }
  });
});
