---
name: grant-vm-access
description: Give an existing workload its own least-privilege Factorize access.
---

Confirm the team, provider connection, and exact VM. Use
`grant_vm_permissions` with explicit scopes and a stable request key. Verify
access from inside the workload with its enrolled identity, never a human token
or a private key copied out of the VM. Use `list_vms` to verify and
`revoke_vm_permissions` for the exact grant when temporary access ends.

Follow the [VM recipe](https://docs.factorize.sh/work/vm-access) and
[MCP reference](https://docs.factorize.sh/mcp/tools#vm-permissions).
