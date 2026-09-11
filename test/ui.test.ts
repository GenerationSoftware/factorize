import { describe, expect, it } from "vitest";
import { flowDetailPage, flowPage, landingPage } from "../src/ui";

describe("pages", () => {
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
    expect(html).toContain('href="/flows/new"');
    expect(html).toContain('href="https://github.com/asselstine/factorize" target="_blank"');
    expect(html).toContain("Host it Yourself");
    expect(html).toContain("View on GitHub");
    expect(html).toContain('id="theme-toggle"');
    expect(html).toContain("dark:bg-slate-950");
  });

  it("renders all three flow configuration sections", () => {
    const html = flowPage({ email: "owner@example.com" });
    expect(html).toContain("Linear config");
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
  });

  it("renders flow-level webhook and agent-run activity", () => {
    const html = flowDetailPage({ email: "owner@example.com" }, "flow-1");
    expect(html).toContain("Webhook activity");
    expect(html).toContain("Agent runs");
    expect(html).toContain("/api/pipes/");
    expect(html).toContain("whether they queued an agent");
    expect(html).toContain("Edit Flow");
    expect(html).toContain("issueLink");
    expect(html).toContain("Prompt sent to agent");
  });

  it("escapes profile data", () => {
    const html = landingPage({ email: '<script>alert("x")</script>@example.com' });
    expect(html).not.toContain('<script>alert("x")</script>@example.com');
    expect(html).toContain("&lt;script&gt;");
  });
});
