import { describe, expect, it } from "vitest";
import { createFlyHttpGuestTransport } from "../src/fly-http-guest-transport";

const options = {app: "selected-app", machine: "machine-1", token: "server-held-token"};
describe("Worker-compatible Fly guest exec transport", () => {
  it("uses argv and stdin through the documented HTTP API without a CLI", async () => {
    const command = ["printf", "%s", "$(do-not-run) ' literal"];
    const guest = createFlyHttpGuestTransport({...options, fetcher: async (input, init) => {
      expect(String(input)).toBe("https://api.machines.dev/v1/apps/selected-app/machines/machine-1/exec");
      expect(init?.headers).toMatchObject({Authorization: "Bearer server-held-token"});
      expect(JSON.parse(String(init?.body))).toEqual({command, stdin: "job input", timeout: 30});
      expect(init?.redirect).toBe("error");
      return Response.json({stdout: "output", stderr: "failure", exit_code: 7});
    }});
    expect(await guest.run(command, "job input")).toEqual({ok: false, exitCode: 7, stdout: "output", stderr: "failure"});
  });

  it("transports file bytes without interpolating a guest filename into shell text", async () => {
    const bytes = new Uint8Array([0, 128, 255, 42]);
    let commands = 0;
    const guest = createFlyHttpGuestTransport({...options, fetcher: async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      if (++commands === 1) {
        expect(request.command).toEqual(["/bin/sh", "-c", 'umask 077; base64 -d > "$1"', "factorize-upload", "/tmp/literal ' $(file)"]);
        expect(request.stdin).toBe(Buffer.from(bytes).toString("base64"));
        return Response.json({stdout: "", stderr: "", exit_code: 0});
      }
      expect(request.command[0]).toBe("python3");
      expect(request.command[3]).toBe("/tmp/file");
      return Response.json({stdout: Buffer.from(bytes).toString("base64"), stderr: "", exit_code: 0});
    }});
    await guest.upload("/tmp/literal ' $(file)", bytes);
    expect(await guest.download("/tmp/file")).toEqual(bytes);
    await expect(guest.upload("/tmp/../escape", bytes)).rejects.toThrow("path");
  });

  it("bounds output and sanitizes provider failures", async () => {
    for (const response of [Response.json({stdout: "too-large", stderr: "", exit_code: 0}), Response.json({error: "server-held-token"}, {status: 403}), Response.json({stdout: "", stderr: ""})]) {
      const guest = createFlyHttpGuestTransport({...options, outputLimitBytes: 2, fetcher: async () => response});
      await expect(guest.run(["echo", "not-logged"])).rejects.toThrow("Fly guest HTTP transport unavailable");
    }
  });
});
