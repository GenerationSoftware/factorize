import { example } from "./helpers/docs-example";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { requestApiInput } from "../src/agent-api-contracts";
import { eventDefinitionInput } from "../src/events/api/event-contracts";
import { fireTriggerInputSchema, mcpTriggerInputSchema } from "../src/triggers/api/trigger-schemas";
import { vmGrantInput } from "../src/vm-grant-contracts";

describe("canonical Factorize recipe inputs", () => {
  it("documents an isolated read without provider credentials or a request body", async () => {
    const body = requestApiInput.parse(await example("use-an-api", "request_api"));
    expect(body).toMatchObject({ method: "GET", path: "/sample" });
    expect(body.headers).toEqual({});
    expect(body.body).toBeUndefined();
  });

  it("documents enrollment of only an existing Machine and an explicit read grant", async () => {
    const body = vmGrantInput.parse(await example("vm-access", "grant_vm_permissions"));
    expect(body.target).toMatchObject({kind: "machine", requestKey: "hello-factorize-v1"});
    expect(body.permissions).toEqual({scopes: ["triggers:read"]});
  });

  it("documents a matching manual Event schema, Trigger and idempotent fire payload", async () => {
    const details = eventDefinitionInput.parse(await example("triggers", "create_event"));
    const trigger = mcpTriggerInputSchema.parse(await example("triggers", "create_trigger"));
    const fire = fireTriggerInputSchema.extend({triggerId:z.uuid()}).parse(await example("triggers", "fire_trigger"));
    expect(details.payloadSchema).toMatchObject({type:"object", required:["message"]});
    expect(trigger.sources).toEqual([expect.objectContaining({kind:"manual"})]);
    expect(fire).toMatchObject({idempotencyKey:"hello-factorize-1", data:{message:"hello"}});
  });
});
