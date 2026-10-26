# Global skills: implementation plan

Status: proposed implementation plan; no application behavior or existing jobs changed.

## Product contract

A user defines skills globally within their Factorize account. Every project in
that account can use them. In storage and authorization, use the existing tenant
boundary; global never means shared between accounts.

A skill is a name, immutable key, and literal text body. Jobs explicitly include
skills in their existing prompt template:

```text
{{skills.exe_dev}}
{{skills.factorize_project}}
{{skills.development}}

Complete this task:
{{trigger-1.prompt}}
```

Insert each body exactly where referenced, preserving whitespace and order.
Repeated references insert repeated text. Bodies are never parsed or rendered:
`{{trigger-1.prompt}}` and `{{skills.other}}` inside a body remain literal text.
There is no nesting, parameterization, automatic inclusion, project inheritance,
remote fetching, or agent-side skill discovery. Inclusion does not grant access
to repositories or integrations.

Support skills in job prompts only in v1, not run names or invocation task text.
Retain existing Mustache behavior for ordinary job-template values and sections.
Reserve the `skills` namespace and resolve it from server-owned data, independent
of trigger data and the current Mustache section context.

Allow ordinary escaped/unescaped interpolation forms for `skills.KEY`; all insert
the same plain text, as existing prompt interpolation does. Reject skill sections,
inverted sections, partials, bare `skills`, and deeper paths in job templates.
Skill interpolation inside an ordinary trigger section is allowed. Validate all
references at save time, even those inside a currently inactive section. Parse
the job template using the actual Mustache parser, not a regex. Text in comments
and literal text are not references. Skill-looking text inside a skill body is
never scanned for dependencies.

## User experience

- Add Settings > Skills, available independently of the selected project.
- List skill name, key, revision, last update, and number of jobs using it.
  Provide search and create/edit/delete actions with loading and error states.
- Creation suggests a key from the name; the user can edit it before saving.
  Names can change later; keys cannot. Show the exact inclusion syntax.
- Edit the body in a plain-text textarea. Explain that template syntax in the
  body stays literal. Preserve leading/trailing whitespace on save.
- Show linked jobs grouped by project, including disabled jobs. Before saving an
  edit, show that future runs of those jobs will use the new content. Do not add
  a separate approval workflow.
- Block deletion while any saved job references the skill. Return the referencing
  jobs so users can remove references first. Historical runs do not block deletion.
- Add an Insert skill picker to the job prompt editor, inserting at the cursor.
  Do not add this picker to run names. Show directly referenced skills and errors.
- Provide a server-backed prompt preview for unsaved drafts. Support an explicit
  sample trigger context and clearly identify it as sample data. Without sample
  data, show a skill-expanded source view that preserves unresolved trigger tags;
  do not mislabel it as the final runtime prompt. Never render skill text as HTML.
- Run details show the final prompt and the skill names, keys, revisions, and
  exact bodies captured for that run. Distinguish historical snapshots from links
  to the current skill. Legacy runs show no recorded skill provenance.

## Data and concurrency

Add tenant-scoped `skills` records with id, immutable key, name, encrypted body,
integer revision, createdAt, and updatedAt. Require a unique (tenantId, key).
Use the existing encryption approach for prompts. Recommended initial limits:
name 120 characters; key 64 characters matching `[a-z][a-z0-9_]*`; body 50,000
characters with at least one non-whitespace character. Reject prototype-related
reserved keys and use own-property lookups rather than inherited object fields.

Require expectedRevision for new skill update/delete APIs. An edit increments
revision; stale writes return 409. Updating a name also creates a new revision so
snapshot metadata has a single coherent revision identifier. No version pinning
or revision-history UI in v1.

Add a `job_skill_references` relation with tenant-qualified job/skill foreign keys.
Derive it from the prompt source, never accept it as caller-maintained truth.
Save the job and its reference set transactionally. Foreign-key restrictions and
appropriate locking must prevent a concurrent delete from creating a dangling
reference. Disabled jobs count; unsaved editor drafts do not. Moving jobs between
projects does not affect skill resolution.

Add a nullable encrypted skill snapshot to job runs, storing each referenced
skill's id, key, name, revision, and exact body. The final encrypted prompt remains
the authoritative agent input. Snapshot all direct dependencies, including those
in inactive sections, and identify actually inserted skills separately in preview
and provenance if useful. Store snapshots independently of live skill rows so
deletion does not destroy history. Follow existing run retention/deletion rules.

Resolve referenced skills in one consistent database read and persist the prompt
and snapshot together. A concurrent edit may fall before or after that read, but
the recorded revision, body, and rendered prompt must agree. Batch lookups; avoid
one database query per occurrence.

## Rendering and execution

Build one skill-reference parser/resolver used by job validation, preview, and
InvocationService. Extend the existing plain-text Mustache writer to resolve
skill interpolation from a separate trusted map, including inside sections.
Do not expand bodies into template source and then run Mustache over that source.
Do not scan rendered output: trigger data that contains a skill reference must
remain ordinary data. Do not let input data override server-resolved skills.

Resolve current skill revisions when an invocation creates its queued run.
Queued/running runs keep their snapshot after edits. Duplicate idempotency keys
return the original invocation/run without resolving newer revisions. Backend
launch retries reuse the stored prompt; a genuinely new invocation uses current
skills. Skill edits alone do not create runs or emit job-edited lifecycle events.

Wire the common path into manual, scheduled, webhook, and lifecycle invocations,
including scheduler recovery paths. Existing run launch code should continue to
consume the persisted prompt without loading skills again.

Missing references fail job save, preview, and invocation with an actionable
error; never substitute an empty string. Failed automatic invocations must record
the configuration error in existing delivery/scheduler diagnostics without
launching a VM or endlessly retrying a permanent configuration error.

Enforce a bounded rendered prompt during construction, counting repeats and
Mustache section expansion. Proposed skill-enabled prompt limit: 200,000 UTF-8
bytes; confirm backend transport limits before implementation. Preserve existing
limits and behavior for jobs without skills in this change. Preview reports the
actual size. A skill edit can make a future composed prompt too large, so both
preview and invocation must enforce the limit, not just job save.

## REST, MCP, and authorization

Expose documented operations under `/api/v1`, served through protected-api.ts
and the existing contract/service machinery:

| Operation | Route | Required scopes |
| --- | --- | --- |
| List skills, paginated metadata | GET /api/v1/skills | skills:read |
| Create skill | POST /api/v1/skills | skills:write |
| Read skill | GET /api/v1/skills/{skillId} | skills:read |
| Replace editable fields | PUT /api/v1/skills/{skillId} | skills:write |
| Delete unused skill | DELETE /api/v1/skills/{skillId} | skills:write |
| List referencing jobs | GET /api/v1/skills/{skillId}/jobs | skills:read + jobs:read |
| Preview unsaved prompt | POST /api/v1/jobs/prompt-preview | jobs:read + skills:read |

Preview accepts promptTemplate, optional sample context, and source/final mode;
returns text, references/revisions, byte count, and validation diagnostics.
It neither saves a job nor invokes one. Skill mutations return metadata rather
than implicitly granting read access to a write-only caller.

Add skills:read and skills:write to OAuth consent, API-key configuration, session
scopes, scope normalization, discovery, documentation, and tests. Do not silently
expand existing delegated grants. Require skills:read in addition to jobs:write
when creating/changing a prompt that includes skills. Existing clients may edit
unrelated job fields while preserving an unchanged prompt without acquiring a
new scope. Existing runs:invoke permissions can execute saved jobs; execution
resolves dependencies internally, including automation without a user token.

Runs:read continues to expose the complete executed prompt, including included
skill text, just as it exposes instructions today. Explain that skills are reusable
instructions, not secret storage; skills:read controls library access, not removal
of text from authorized run history. Usage metadata must not disclose job names
to callers without jobs:read.

Provide MCP list_skills, get_skill, create_skill, update_skill, delete_skill,
list_skill_jobs, and preview_job_prompt through the same service layer and scope
rules. Keep existing job writes and conditional-update omission compatibility.
Update packages/docs/openapi.yaml and regenerate factorize-api-client; the frontend
must use that client and never import backend rendering code.

## Implementation sequence and validation

1. Add schema migration, encrypted storage, revision checks, usage relation, and
   tenant isolation. Test conflicting keys, stale writes, job-save/delete races,
   and preserving snapshots after deletion.
2. Implement reference parsing, literal insertion, validation, size accounting,
   and the shared invocation resolver. Cover every trigger path and idempotency.
3. Add REST/MCP contracts, scopes, preview, run provenance, and generated client.
   Test authorization at boundaries and cross-account reference attempts.
4. Build Skills settings, job insertion/preview, usage links, and run provenance.
   Browser tests cover create/include/edit/preview/delete-blocked flows, stale
   edits, missing references, and literal braces in skill bodies.
5. Document syntax, permissions, limits, update timing, and migration examples.
   Run npm run generate after contract changes. With Node 24.12.0 and npm 11.19.0,
   run npm ci for a clean checkout, bootstrap isolated test prerequisites as
   needed, and run the root npm test after the final code change. Include boundary
   validation; targeted iteration tests do not replace the root suite.

Critical rendering cases: whitespace/Unicode, HTML-like text, literal Mustache
in skill bodies and trigger payloads, repeated references, inactive/looped
sections, alternate delimiters, malformed and unknown references, reserved keys,
section-local shadowing, cross-account isolation, and expanded-size overflow.
Regression tests must show unchanged behavior for jobs with no skill references.

## Release and migration

Use additive schema and API changes. Deploy the skill-aware backend before the
frontend can save references. Check existing prompt sources for use of the newly
reserved skills namespace before enabling the feature. Do not alter existing
jobs automatically; an empty skills library leaves all current jobs unchanged.

Once skill-backed prompts are saved, rolling back to a backend that silently
ignores skills is unsafe. Retain the compatible renderer during rollback, or
first disable/migrate affected jobs to literal prompts. Disabling only the UI
does not make an old renderer safe. Preserve existing deployment/asset gates.

Initial manual migration candidates: exe_dev, factorize_project, anarack_project,
then shared development/dispatcher/merge procedures. Compare effective prompts
before and after extraction. Preserve project-specific checkpoint, validation,
recovery, and authorization differences; do not mechanically merge divergent
workflows. Skill updates are not deployments of permission changes.

Out of scope: nested or parameterized skills, implicit inheritance, external skill
imports, AGENTS.md generation, project resource pickers, workflow engines, version
pinning, and changing runtime task/run-identity contracts. Those can be separate
features after this explicit composition model is established.
