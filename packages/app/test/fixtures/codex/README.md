exec-0.161.0.jsonl was captured from codex-cli 0.161.0 using codex exec --json
against the attached exe-llm provider, with a prompt to run printf trace-fixture
once and reply Done. It contains no credentials. native-calls.jsonl is a minimized
schema fixture for current custom_tool_call/custom_tool_call_output and historical
function_call/function_call_output session records. Additional documented item
shapes and error/future-event cases are exercised in codex-trace.test.ts.
Official stdout contract: https://developers.openai.com/codex/noninteractive/
