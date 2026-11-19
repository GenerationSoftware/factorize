import { z } from "zod";
import { SKILL_KEY, SKILL_BODY_LIMIT } from "./skills";

export const skillFile = z.object({
  path: z.string().min(1).max(1024),
  content: z.string(),
  executable: z.boolean(),
});
export class SkillContentError extends Error {}
export type SkillFile = z.infer<typeof skillFile>;
export type Directory = { key: string; files: SkillFile[] };
export type SkillVersion = { commit: string; files: SkillFile[] };

export function validPath(path: string) {
  return (
    path.length <= 1024 &&
    !/[\\\x00-\x1f\x7f]/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git")
  );
}

export function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
export function markdown(body: string): SkillFile {
  return { path: "SKILL.md", content: base64(new TextEncoder().encode(body)), executable: false };
}

export function bodyOf(directory: Directory) {
  const file = directory.files.find((file) => file.path === "SKILL.md");
  if (!file || !SKILL_KEY.test(directory.key))
    throw new SkillContentError("Each skill needs a valid key and SKILL.md");
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0)),
    );
  } catch {
    throw new SkillContentError("SKILL.md must contain UTF-8 text");
  }
  if (body.length > SKILL_BODY_LIMIT) throw new SkillContentError("SKILL.md exceeds the skill body limit");
  return body;
}

export function snapshotFiles(snapshot: { key: string; body: string; version?: SkillVersion }[]) {
  return snapshot.flatMap((skill) =>
    (skill.version?.files ?? [markdown(skill.body)]).map((file) => ({
      ...file,
      path: skill.key + "/" + file.path,
    })),
  );
}

export const SKILL_LIBRARY_BYTES = 8 * 1024 * 1024;
export const SKILL_LIBRARY_ENTRIES = 2000;

export function validateLibrary(dirs: Directory[]) {
  let count = 0,
    bytes = 0;
  for (const dir of dirs) {
    bodyOf(dir);
    for (const file of dir.files) {
      bytes +=
        (file.content.length * 3) / 4 -
        (file.content.endsWith("==") ? 2 : file.content.endsWith("=") ? 1 : 0);
      if (++count > SKILL_LIBRARY_ENTRIES || bytes > SKILL_LIBRARY_BYTES || !validPath(file.path))
        throw new SkillContentError("Skills exceed the library limits");
    }
  }
}
