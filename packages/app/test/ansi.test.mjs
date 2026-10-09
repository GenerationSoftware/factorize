import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnsi } from "../src/features/runs/ansi.ts";
test("terminal styles preserve text and strip executable OSC links and cursor commands", () => {
  const tokens = parseAnsi('\x1b]8;;javascript:alert(1)\x07<img onerror="alert(1)">\x1b]8;;\x07\x1b[31;1mRed\x1b[0m\x1b[2JPlain');
  assert.equal(tokens.map(token => token.text).join(""), '<img onerror="alert(1)">RedPlain');
  assert.equal(tokens[1].style.color, "#ef4444"); assert.equal(tokens[1].style.fontWeight, 700);
  assert.equal(tokens[2].style.color, undefined);
  assert.equal(parseAnsi('\x1b[38;2;12;34;56mRGB')[0].style.color, "rgb(12,34,56)");
  assert.equal(parseAnsi('\x1b[38;5;200mIndexed')[0].style.color, "rgb(255,0,215)");
});
