These fixtures target the deployed **@earendil-works/pi-coding-agent 1.1.0**,
session JSONL **v3**.

- `documented-v3.jsonl` is a representative contract fixture covering every
  published entry type, multi-tool assistant blocks, image omission, usage,
  prompt patches, compaction checkpoints, and sibling branches. It includes a
  future entry to exercise forward-compatible metadata.
- `native-session.jsonl` is unmodified session output captured from the exe.dev
  Pi 1.1.0 binary. The only model is a local deterministic OpenAI-compatible
  fixture server; Pi itself serializes the session, invokes bash, and stores its
  result. No external credentials or existing sessions are used.
- `python3 capture.py` regenerates the actual-output fixture using the documented
  compatible-endpoint configuration. IDs, timestamps, and temporary paths vary.

Compatibility references shipped with that release:
[session format](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/session-format.md)
and [message types](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/message-types.md).
The installed release copies were used when creating the fixtures.
