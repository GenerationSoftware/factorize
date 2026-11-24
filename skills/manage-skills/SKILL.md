---
name: manage-skills
description: Discover, author, and safely edit standalone Factorize team Skills.
---
# Manage team Skills

Team Skills are reusable Markdown instruction documents. They are independent
of Events and Triggers; creating or editing a Skill does not configure an input
source or publish an Event.

## Discover and read

Use `list_skills` to find Skills and `get_skill` to read the full body and
revision. Lists omit bodies. These operations require `skills:read`.

## Author and edit

`create_skill` requires `skills:write`; supply a unique key and a literal
Markdown body, optionally with standard SKILL.md frontmatter. Skills contain
instructions, not execution configuration. Avoid credentials and transient
team inventories.

Read `get_skill` immediately before `update_skill`. Pass the returned
`skillId`, current `expectedRevision`, and the intended body (plus key when
renaming). On a stale write, reread and merge; do not blindly retry with a new
revision.

## Verify and delete

After saving, read the Skill again and confirm the body and revision.
`delete_skill` requires `skills:write`, `skillId`, and `expectedRevision`.
