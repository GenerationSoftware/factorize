import { expect, it } from "vitest";
import { readSkillDefinition, writeSkillDefinition } from "../src/skill-definition";

it("reads a standalone skill document", () => {
  expect(readSkillDefinition("# Literal {{body}}\n", "example")).toEqual({ name: "example", description: "", markdown: "# Literal {{body}}\n" });
});
it("preserves skill metadata, comments and body while removing retired execution metadata", () => {
  const source = '---\nname: example\ndescription: A skill\n# retain me\nlicense: MIT\nmetadata:\n  other: retained\n  factorize:\n    old: run-setting\n---\n# Body\n\n```sh\necho "$HOME"\n```\n';
  const before = readSkillDefinition(source, "example");
  const saved = writeSkillDefinition(source, { ...before, description: "Updated" });
  expect(saved).toContain("# retain me");
  expect(saved).toContain("license: MIT");
  expect(saved).toContain("other: retained");
  expect(saved).not.toContain("run-setting");
  expect(readSkillDefinition(saved, "example")).toMatchObject({ description: "Updated", markdown: before.markdown });
});
it.each(["---\n[broken\n---\n", "---\n- array\n---\n"])("rejects invalid frontmatter %s", source => {
  expect(() => readSkillDefinition(source, "example")).toThrow();
});
