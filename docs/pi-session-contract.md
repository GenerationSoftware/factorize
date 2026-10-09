# Pi native session projection

Factorize supports the exe.dev **@earendil-works/pi-coding-agent 1.1.0**
binary and its published **session JSONL v3** contract. Pi launches check
`pi --version` before passing the prompt to the CLI; a different version fails
with a harness diagnostic. Guest image owners must install the supported release.
An upgrade requires reviewing the release's session/message contracts, capturing
new versioned fixtures, and changing the version constant and tests together.

The compatibility reference is the release's
[session format](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/session-format.md)
and [message types](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/message-types.md),
also shipped in the binary's docs directory. Fixtures live in
`packages/api/test/fixtures/pi/1.1.0`; their README documents reproduction.

Pi's primary source is the native session discovered under its run-specific
`--session-dir`. Both live projection and terminal reconciliation read this file.
Source receipts record `native_session`, CLI version `1.1.0`, and format version
`3`. Plain print-mode stdout remains terminal output and is never advertised as
a complete execution stream.

Projection retains all branches in append order, including abandoned history.
It does not rebuild only the active model context or apply context edits to
historical display content. Every event retains its native entry ID, parent,
and ISO timestamp; display provenance also retains null roots and the nested
Unix-millisecond message timestamp. Several content-block or usage events may
share one native entry ID. `display.blockIndex` identifies content blocks;
`display.toolCallId` links tool calls and results independently of entry IDs.

The UI shows text/thinking, tool arguments/results, direct bash executions,
usage, compaction and branch summaries. Metadata retains model/thinking changes,
system prompt/tool patches, context edits, labels, session info, custom entries,
unknown roles and future records. Compaction retains `firstKeptEntryId`,
checkpoint, and token counts; branches retain `fromId` and their actual parent.
Arguments, results and extension metadata are bounded for display; images and
opaque replay signatures are omitted. The native artifact remains exact.

The projector never rewrites or migrates stored artifacts. Pi itself migrates
v1 (linear) to v2 (tree) and v2 `hookMessage` to v3 `custom` on load. Historical
headers without a version or with non-v3 versions are marked
`best_effort_unmigrated`; available IDs are preserved and absent ancestry is
not invented. Legacy `hookMessage` is displayed as custom metadata. Unknown
future types use bounded metadata, malformed JSON uses warning events, and
invalid timestamps remain display metadata rather than invalid database dates.
This fallback is for retained artifacts, not authorization to launch unreviewed
CLI versions.
