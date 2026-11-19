import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "factorize-api-client";
import { Button, Card, Input, Label, Select } from "../../shared/ui";
import { installationsQuery, repositoriesQuery } from "../jobs/provider-queries";

const failure = (error: any) => new Error(error?.error?.message ?? "Repository request failed");
export function SkillsRepository() {
  const cache = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState("managed");
  const [installation, setInstallation] = useState(0),
    [repository, setRepository] = useState(0);
  const [branch, setBranch] = useState("main"),
    [folder, setFolder] = useState("skills");
  const status = useQuery({
    queryKey: ["skill-library"],
    queryFn: async () => {
      const result = await api.GET("/api/v1/skill-library");
      if (!result.data) throw failure(result.error);
      return result.data;
    },
  });
  const installations = useQuery({ ...installationsQuery, enabled: editing && kind === "github" });
  const repositories = useQuery({
    ...repositoriesQuery(installation),
    enabled: editing && kind === "github" && installation > 0,
  });
  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["skill-library"] }),
      cache.invalidateQueries({ queryKey: ["skills"] }),
    ]);
  }
  const configure = useMutation({
    mutationFn: async () => {
      const result = await api.PUT("/api/v1/skill-library", {
        body:
          kind === "managed"
            ? { kind: "managed" }
            : { kind: "github", installationId: installation, repositoryId: repository, branch, folder },
      });
      if (!result.data) throw failure(result.error);
    },
    onSuccess: async () => {
      setEditing(false);
      token.reset();
      await refresh();
    },
  });
  const sync = useMutation({
    mutationFn: async () => {
      const result = await api.POST("/api/v1/skill-library/sync");
      if (!result.data) throw failure(result.error);
    },
    onSuccess: refresh,
  });
  const token = useMutation({
    mutationFn: async () => {
      const result = await api.POST("/api/v1/skill-library/token");
      if (!result.data) throw failure(result.error);
      return result.data;
    },
  });
  const active = status.data;
  return (
    <Card className="mb-6 grid gap-3">
      <h2>Git repository</h2>
      {active?.source?.kind === "managed" && (
        <Label>
          Factorize remote
          <Input readOnly value={active.remote ?? ""} />
          <span>
            Store each skill in <code>skills/&lt;key&gt;/SKILL.md</code> alongside its supporting files.
          </span>
        </Label>
      )}
      {active?.source?.kind === "github" && (
        <p>
          GitHub repository {active.source.repositoryId} · {active.source.branch} ·{" "}
          {active.source.folder || "/"}
        </p>
      )}
      {active?.commit && (
        <p>
          Published commit <code>{active.commit.slice(0, 12)}</code>
          {active.source?.kind === "github" && (
            <>
              {" "}
              · GitHub commit <code>{active.upstreamCommit?.slice(0, 12)}</code>
            </>
          )}
        </p>
      )}
      {active?.error && <p role="alert">{active.error}</p>}
      {!editing && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setKind(active?.source?.kind ?? "managed");
              if (active?.source?.kind === "github") {
                setInstallation(active.source.installationId);
                setRepository(active.source.repositoryId);
                setBranch(active.source.branch);
                setFolder(active.source.folder);
              }
              setEditing(true);
            }}
          >
            {active?.source ? "Change repository" : "Connect Git repository"}
          </Button>
          {active?.source && (
            <Button disabled={sync.isPending} onClick={() => sync.mutate()}>
              Sync now
            </Button>
          )}
          {active?.source?.kind === "managed" && (
            <Button disabled={token.isPending} onClick={() => token.mutate()}>
              Get Git credential
            </Button>
          )}
        </div>
      )}
      {token.data && (
        <Label>
          Git bearer token · expires {new Date(token.data.expiresAt).toLocaleTimeString()}
          <Input
            readOnly
            spellCheck={false}
            autoComplete="off"
            value={token.data.token}
            onFocus={(e) => e.target.select()}
          />
        </Label>
      )}
      {editing && (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            configure.mutate();
          }}
        >
          <Label>
            Push skills to
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="managed">Factorize</option>
              <option value="github">GitHub</option>
            </Select>
          </Label>
          {kind === "github" && (
            <>
              <Label>
                Installation
                <Select
                  required
                  value={installation || ""}
                  onChange={(e) => {
                    setInstallation(Number(e.target.value));
                    setRepository(0);
                  }}
                >
                  <option value="">Choose installation</option>
                  {installations.data
                    ?.filter((i) => i.state === "active")
                    .map((i) => (
                      <option key={i.installationId} value={i.installationId}>
                        {i.accountLogin}
                      </option>
                    ))}
                </Select>
              </Label>
              <Label>
                Repository
                <Select
                  required
                  value={repository || ""}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setRepository(id);
                    setBranch(repositories.data?.find((r) => r.id === id)?.defaultBranch ?? "main");
                  }}
                >
                  <option value="">Choose repository</option>
                  {repositories.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName}
                    </option>
                  ))}
                </Select>
              </Label>
              <Label>
                Branch
                <Input required value={branch} onChange={(e) => setBranch(e.target.value)} />
              </Label>
              <Label>
                Skills folder
                <Input value={folder} onChange={(e) => setFolder(e.target.value)} />
              </Label>
              <p>
                Choose an existing branch. Each skill lives in its own folder with a SKILL.md file. Connecting
                publishes the branch’s skills to future runs and commits any missing Factorize skills to this
                folder.
              </p>
            </>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={configure.isPending}>
              Save repository
            </Button>
            <Button type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {[status.error, configure.error, sync.error, token.error, installations.error, repositories.error]
        .filter(Boolean)
        .map((error, i) => (
          <p key={i} role="alert">
            {error?.message}
          </p>
        ))}
    </Card>
  );
}
