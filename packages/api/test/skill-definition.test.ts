import { expect, it } from "vitest";
import { readSkillDefinition, writeSkillDefinition } from "../src/skill-definition";

it("defaults to inherited presets, unlimited concurrency and enabled", () => {
  expect(readSkillDefinition("# Literal {{body}}\n", "example")).toEqual({ name: "example", description: "", factorize: { concurrency: 0, disabled: false }, markdown: "# Literal {{body}}\n" });
});
it("round trips controls without losing unknown metadata, comments or body", () => {
  const source = '---\nname: example\ndescription: A skill\n# retain me\nlicense: MIT\nmetadata:\n  other: retained\n  factorize:\n    custom: value\n    vm-preset: old\n---\n# Body\n\n```sh\necho "$HOME"\n```\n';
  const before = readSkillDefinition(source, "example");
  const next = { ...before, factorize: { ...before.factorize, "vm-preset": undefined, "model-preset": "careful", concurrency: 0, disabled: true } };
  const saved = writeSkillDefinition(source, next);
  expect(saved).toContain("# retain me");
  expect(saved).toContain("license: MIT");
  expect(saved).toContain("other: retained");
  expect(saved).toContain("custom: value");
  expect(readSkillDefinition(saved, "example")).toEqual(next);
});
it.each(["---\n[broken\n---\n", "---\n- array\n---\n", "---\nmetadata: nope\n---\n", "---\nmetadata:\n  factorize:\n    vm-preset: Bad Slug\n---\n", "---\nmetadata:\n  factorize:\n    concurrency: -1\n---\n", "---\nmetadata:\n  factorize:\n    disabled: yes\n---\n", "---\nmetadata:\n  factorize:\n    concurrency: 2147483648\n---\n"])("rejects invalid definitions %s", source => {
  expect(() => readSkillDefinition(source, "example")).toThrow();
});
