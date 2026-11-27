# VM permissions validation

## Local acceptance

Run the documented [Factorize validation runner](factorize-validation-runner.md)
with an isolated database. Run `npm ci`, then `npm run test:local`. The suite
exercises the real Worker REST and MCP entry points with provider API fixtures
and signed test tokens. It also verifies concurrent replay prevention, scope
delegation, migration, revocation, retained proxy access, and the VMs page.

The local suite establishes Factorize's behavior given known provider inputs.
Record live identity evidence separately for each provider.

## Live smoke

Use an explicitly authorized test team and dedicated disposable VMs. Run
against a test Worker with the grant migration applied. Keep real provider
tokens, signing proofs, and private keys out of logs and verification records.

1. Try to enroll an exe.dev target with `grant_vm_permissions`. Confirm the
   Worker rejects enrollment and the VM does not appear in `list_vms`.
2. On the isolated test Worker, create a Fly.io grant for the target Machine
   and confirm the list reports the exact app and Machine ID. Use the guest
   key and provider token to exercise an allowed REST operation and MCP tool,
   following the [workload authentication reference](../packages/docs/mcp/tools.mdx).
3. From another Machine in the same app, request its own token for the
   original grant audience. Assert both REST and MCP deny it even when the
   test transport has access to the original proof key. Repeat for a clone and
   a same-name replacement. Confirm the signed Machine IDs differ from the
   enrolled ID. Exercise a proof replay and verify that only its first use
   succeeds.
4. Edit the grant to remove a scope, then verify the affected operation fails
   through REST and MCP. Revoke the grant and verify both surfaces deny fresh
   requests before the provider token expires. Confirm the provider Machine
   keeps running. Re-grant the Machine and verify that old identity material
   cannot authenticate to the new grant.
5. For exe.dev, first identify the documented provider signal that establishes
   the original machine across renames, replacement, and disk cloning. Repeat
   the intended-VM and peer checks, then test rename, same-name replacement,
   a moved or shared WIF attachment, and a disk clone with the original proof
   key. A same-name replacement or copied key must never make the new guest
   eligible. Verify provider failure prevents admission.
6. Record the tested build, provider and test resource identifiers, expected
   and observed outcomes, and whether the provider checks passed. Record
   unavailable checks as pending. Apply the normal
   [release and rollback procedure](package-migration.md) after the provider
   passes.

## Provider validation record

| Provider | Live evidence | Production setting |
| --- | --- | --- |
| Fly.io | Pending dedicated test Worker and Machines | No deployment flag required |
| exe.dev | Pending a documented VM-continuity signal and dedicated test VMs | Enrollment and authentication are disabled in code |
