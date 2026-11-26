import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function example(file: string, tool: string) {
  const guide = await readFile(resolve(import.meta.dirname, "../../../docs/work", file + ".mdx"), "utf8");
  const marker = "```json " + tool + "\n";
  const text = guide.split(marker)[1]?.split("\n```")[0];
  if (!text) throw new Error("Missing documented JSON input for " + tool);
  return JSON.parse(text);
}
