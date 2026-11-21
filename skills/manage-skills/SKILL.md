---
name: manage-skills
description: Discover, author and safely edit reusable Factorize team skills, including execution metadata and dependencies.
---
# Manage team skills

These are editable team instructions used as run inputs. They are distinct from Factorize's build-shipped MCP workflow skills. The MCP Skills extension exposes only built-in workflows: use tools for live team-library data.

## Discover and read

Call `get_api_reflection`, `list_skills({"q":"review","limit":30})` and `get_skill({"skillId":"RETURNED_ID_OR_KEY"})`. Follow `cursor`/`nextCursor` pagination; lists omit bodies. These operations require `skills:read`. Read the complete body, structured `definition`, revision and current preset references before editing. Use `list_presets` to resolve valid slugs and inherited defaults.

## Author

`create_skill` requires `skills:write`; changes to Factorize execution controls also require `triggers:write`. Supply `key` and literal Markdown `body`, including standard SKILL.md YAML frontmatter:

```json
{"key":"review-changes","body":"---\nname: review-changes\ndescription: Review repository changes and report evidence.\nmetadata:\n  factorize:\n    concurrency: 1\n    disabled: false\n---\nInspect the requested changes. Run relevant checks and report findings with evidence.\n"}
```

Names use lowercase letters/digits and single hyphens, at most 64 characters; `manual` is reserved. Put execution choices under `metadata.factorize`: optional `vm-preset`, `permission-preset`, `model-preset` slugs, `concurrency` (0 means unlimited), and `disabled`. Omitted preset keys inherit team defaults. Avoid embedding credentials, transient team inventories, run IDs or template-specific assumptions in reusable instructions. Mustache-looking text in a skill is literal; event templates belong to triggers.

## Edit safely

Read `get_skill` immediately before `update_skill`. Pass `skillId`, `expectedRevision`, and the intended `body` (and `key` if renaming). Preserve unrelated YAML metadata, Markdown and supporting files. A structured `definition` can update managed frontmatter, but preserve all intended fields and Markdown. On a stale write, reread and merge. Do not blindly retry with a newer revision.

Shared edits affect future runs of every referencing trigger. Call `list_skill_triggers({"skillId":"RETURNED_ID"})` to inspect that impact. Accepted runs keep their pinned skill package and preset snapshots; renames and edits do not change those inputs. Set `disabled: true` to block new runs without stopping existing work or erasing automation. Use the browser directory editor for supporting files; the basic create/update tools author the main document.

## Verify, preview and delete

After saving, reread `get_skill`; confirm the revision, literal instructions and metadata. Use `preview_trigger_prompt` with `skillId`, optional `prompt`, and representative event data to inspect composition without running work. Use `start_run` to execute (see run-and-supervise); skill creation alone does not launch a run.

`delete_skill` requires `skills:write`, `skillId`, and `expectedRevision`. Referencing triggers block deletion; inspect dependencies first. Deleting a skill is not a substitute for stopping a run. If a create response is lost, find the key with list/get before recreating it.
