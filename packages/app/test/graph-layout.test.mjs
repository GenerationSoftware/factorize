import assert from "node:assert/strict";
import test from "node:test";
import { positionProjectGraph } from "../src/features/projects/graph-layout.mjs";

const job = id => ({ id, type: "job", label: id });
const edge = (source, target, enabled = true) => ({ source, target, enabled });
const coord = (positions, id) => positions.get(id);

test("manual links affect ranks, disabled links do not, and input permutations are stable", () => {
  const nodes = [job("c"), job("a"), job("d"), job("b")];
  const edges = [edge("a", "b", false), edge("c", "d"), edge("a", "c", true), edge("b", "d", true), edge("d", "a", false)];
  const expected = [...positionProjectGraph(nodes, edges)].sort(([a], [b]) => a.localeCompare(b));
  for (const n of [nodes.toReversed(), [nodes[1], nodes[3], nodes[0], nodes[2]]]) {
    for (const e of [edges.toReversed(), [...edges].sort((a, b) => `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`))]) {
      assert.deepEqual([...positionProjectGraph(n, e)].sort(([a], [b]) => a.localeCompare(b)), expected);
    }
  }
  const positions = new Map(expected);
  assert.equal(coord(positions, "c").x, coord(positions, "a").x + 350);
  assert.equal(coord(positions, "b").x, coord(positions, "a").x);
});

test("cycles share a meaningful layer and feedback edges do not create runaway columns", () => {
  const nodes = [job("a"), job("b"), job("c"), job("d")];
  const positions = positionProjectGraph(nodes, [edge("a", "b"), edge("b", "c"), edge("c", "b"), edge("c", "d")]);
  assert.equal(positions.get("b").x, positions.get("c").x);
  assert.equal(positions.get("d").x, positions.get("b").x + 350);
  assert.equal(positions.get("a").x, positions.get("b").x - 350);
  assert.notEqual(positions.get("b").y, positions.get("c").y);
});

test("branch and merge ordering follows connected neighbors to avoid a crossing", () => {
  const nodes = [job("a"), job("b"), job("c"), job("d"), job("merge")];
  const edges = [edge("a", "d"), edge("b", "c"), edge("c", "merge"), edge("d", "merge")];
  const positions = positionProjectGraph(nodes, edges);
  assert.ok(positions.get("a").y < positions.get("b").y);
  assert.ok(positions.get("d").y < positions.get("c").y);
  assert.ok(positions.get("merge").x > positions.get("d").x);
  assert.notEqual(positions.get("c").y, positions.get("d").y);
});

test("webhook sources follow their enabled targets and remain separated", () => {
  const nodes = [job("a"), job("b"), { id: "hook-2", type: "webhook", label: "Hook 2" }, { id: "hook-1", type: "webhook", label: "Hook 1" }];
  const positions = positionProjectGraph(nodes, [edge("a", "b"), edge("hook-1", "a"), edge("hook-2", "b")]);
  assert.ok(positions.get("hook-1").y < positions.get("hook-2").y);
  assert.ok(positions.get("hook-2").y > positions.get("hook-1").y + 70);
  assert.equal(positions.get("hook-1").x, positions.get("hook-2").x);
});
