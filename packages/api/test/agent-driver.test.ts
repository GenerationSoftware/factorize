import {describe,it,expect} from "vitest";
import {historicalTraceSources} from "../src/agent-driver";
import {validateTraceSources} from "../src/trace-source";
describe("historical agent provenance",()=>{
 it("retains readable source metadata without constructing a guest launch",()=>{
  for(const kind of ["codex","claude","pi"] as const){const sources=historicalTraceSources(kind,"archived-run");validateTraceSources(sources);expect(sources.primary.provider).toBe(kind);expect(sources).not.toHaveProperty("executable");}
  expect(historicalTraceSources("pi","archived-run").primary).toMatchObject({cliVersion:"1.1.0",formatVersion:"3"});
 });
});
