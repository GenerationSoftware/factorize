import { z } from "zod";
import { mcpTool } from "../../transport/mcp/tool";
import { sshExecInput } from "./contracts";

export const sshTools = [
  mcpTool(null, "get_ssh_public_key", "Get the public SSH key of this saved Factorize client. Install it on a server account to grant that key access. The private key is never returned.",
    z.strictObject({}), service => () => service.ssh.publicKey()),
  mcpTool<z.infer<typeof sshExecInput>>(null, "ssh_exec", "Run one non-interactive SSH command. Supply a saved targetId or a hetznerServerId from the native Hetzner server list. The Hetzner server must have a verified host fingerprint. The server decides if this client's key is authorized. Each call opens a fresh command channel, possibly on a warm connection. Do not retry a timed-out command blindly.",
    sshExecInput, service => input => service.ssh.exec(input)),
];
