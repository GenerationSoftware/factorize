import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import { linearTicketPrompt, renderContextTemplate } from "../src/tenant";

describe("Linear ticket prompt", () => {
  it("uses concise frontmatter, title, and description instead of webhook JSON", () => {
    const prompt = linearTicketPrompt({
      id: "issue-id", identifier: "GEN-1979", url: "https://linear.app/acme/issue/GEN-1979/add-a-file",
      title: "Add a file to tank", description: "Create `WHOA.md` with `it works!`.",
      project: { name: "Shred" }, labels: [{ name: "odds-n-ends" }], assignee: { name: "Brendan" }, state: { name: "Todo" },
    }, "flow");
    expect(prompt).toBe(`---
pipe: "flow"
issue: "GEN-1979"
url: "https://linear.app/acme/issue/GEN-1979/add-a-file"
project: "Shred"
labels: ["odds-n-ends"]
owner: "Brendan"
status: "Todo"
---

# Add a file to tank

Create \`WHOA.md\` with \`it works!\`.`);
    expect(prompt).not.toContain('"description"');
  });

  it("renders custom Mustache templates against the Linear payload and normalized ticket", () => {
    const prompt = renderContextTemplate("{{flow.name}}: {{ticket.identifier}} — {{{ticket.description}}} ({{custom.release}})", {
      id: "issue-id", identifier: "GEN-1979", description: "Use `extra` context.", custom: { release: "2026.09" },
    }, "bug-fixes");
    expect(prompt).toBe("bug-fixes: GEN-1979 — Use `extra` context. (2026.09)");
  });

  it("decodes HTML entities in ticket content before rendering the prompt", () => {
    const prompt = linearTicketPrompt({
      identifier: "GEN-2063", title: "Run prompt formatting",
      description: "Fix the merge conflicts in https:&#x2F;&#x2F;github.com&#x2F;GenerationSoftware&#x2F;factorize&#x2F;pull&#x2F;100 &amp; keep the link.",
    }, "flow");

    expect(prompt).toContain("https://github.com/GenerationSoftware/factorize/pull/100 & keep the link.");
    expect(prompt).not.toContain("&#x2F;");
  });
});
