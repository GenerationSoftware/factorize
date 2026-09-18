import type { Env } from "../types";
import { clickUpJson } from "../clickup";
import { githubCollection, githubHeaders, installationToken, normalizeRepository } from "../github";
import { isLinearAuthenticationError, LINEAR_OPTION_QUERIES, LINEAR_PROJECTS_QUERY, refreshLinearToken } from "../linear";
import { ConnectionRepository } from "./connection-repository";
import type { Database } from "./database";
import { GitHubRepository } from "./github-repository";

/** Provider discovery is application code; it has no dependency on a VM or Durable Object. */
export class ProviderCatalog {
  private readonly connections: ConnectionRepository;
  constructor(private database: Database, private env: Env, private tenantId: string) {
    this.connections = new ConnectionRepository(database, tenantId, env.CREDENTIAL_ENCRYPTION_KEY);
  }

  private async linear(query: string): Promise<any> {
    const connection = await this.connections.get<any>("linear");
    if (!connection) throw new Error("Connect Linear first");
    const request = async (token: string) => {
      const response = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables: {} }) });
      return { response, payload: await response.json() as any };
    };
    let result = await request(connection.accessToken);
    if (isLinearAuthenticationError(result.response.status, result.payload.errors)) {
      const tokens = await refreshLinearToken(connection.refreshToken, this.env.LINEAR_CLIENT_ID, this.env.LINEAR_CLIENT_SECRET);
      await this.connections.put("linear", { ...connection, accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? connection.refreshToken });
      result = await request(tokens.access_token);
    }
    if (!result.response.ok || result.payload.errors?.length) throw new Error(result.payload.errors?.[0]?.message ?? `Linear request failed (${result.response.status})`);
    return result.payload.data;
  }

  async linearProjects() { return (await this.linear(LINEAR_PROJECTS_QUERY)).projects.nodes; }
  async linearOptions() {
    const [statuses, users, labels] = await Promise.all([this.linear(LINEAR_OPTION_QUERIES.statuses), this.linear(LINEAR_OPTION_QUERIES.users), this.linear(LINEAR_OPTION_QUERIES.labels)]);
    return { statuses: statuses.workflowStates.nodes, users: users.users.nodes, labels: labels.issueLabels.nodes };
  }
  async clickUpLists() {
    const connection = await this.connections.get<any>("clickup");
    if (!connection) throw new Error("Connect ClickUp first");
    const spaces = (await clickUpJson(connection.accessToken, `/team/${connection.teamId}/space?archived=false`)).spaces ?? [], lists: Array<{ id: string; name: string }> = [];
    for (const space of spaces) {
      const [folders, folderless] = await Promise.all([clickUpJson(connection.accessToken, `/space/${space.id}/folder?archived=false`), clickUpJson(connection.accessToken, `/space/${space.id}/list?archived=false`)]);
      for (const list of folderless.lists ?? []) lists.push({ id: String(list.id), name: `${space.name} / ${list.name}` });
      for (const folder of folders.folders ?? []) for (const list of folder.lists ?? []) lists.push({ id: String(list.id), name: `${space.name} / ${folder.name} / ${list.name}` });
    }
    return lists;
  }
  async clickUpOptions(listId: string) {
    const connection = await this.connections.get<any>("clickup");
    if (!connection || !listId) throw new Error("Connect ClickUp and choose a list first");
    const [list, team, tags] = await Promise.all([clickUpJson(connection.accessToken, `/list/${encodeURIComponent(listId)}`), clickUpJson(connection.accessToken, `/team/${connection.teamId}`), clickUpJson(connection.accessToken, `/team/${connection.teamId}/tag`)]);
    return { statuses: (list.statuses ?? []).map((x: any) => ({ id: x.status, name: x.status })), users: (team.team?.members ?? []).map((x: any) => ({ id: String(x.user.id), name: x.user.username ?? x.user.email })), labels: (tags.tags ?? []).map((x: any) => ({ id: x.name, name: x.name })) };
  }
  async githubRepositories(installationId: number) {
    const installation = await new GitHubRepository(this.database, this.tenantId).installation(installationId);
    if (installation?.state !== "active") throw new Error("Installation is disconnected");
    const token = await installationToken(this.env, installationId), repositories: any[] = [];
    for (let page = 1; page <= 10; page++) { const response = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, { headers: githubHeaders(token) }), body = await response.json() as any; if (!response.ok) throw new Error(body.message ?? `GitHub repository request failed (${response.status})`); repositories.push(...(body.repositories ?? [])); if ((body.repositories ?? []).length < 100) break; }
    return repositories.map(normalizeRepository);
  }
  async githubIssueOptions(installationId: number, repositoryId: number) {
    const installation = await new GitHubRepository(this.database, this.tenantId).installation(installationId);
    if (installation?.state !== "active") throw new Error("GitHub installation is unavailable");
    const token = await installationToken(this.env, installationId), response = await fetch(`https://api.github.com/repositories/${repositoryId}`, { headers: githubHeaders(token) });
    if (!response.ok) throw new Error("GitHub repository is unavailable");
    const repository = await response.json() as any; if (!repository.full_name) throw new Error("GitHub repository is unavailable");
    const load = (path: string) => githubCollection<any>(`https://api.github.com/repos/${repository.full_name}/${path}`, token);
    const [labels, users] = await Promise.all([load("labels"), load("assignees")]);
    return { statuses: [{ id: "open", name: "Open" }, { id: "closed", name: "Closed" }], labels: labels.map(x => ({ id: String(x.id), name: x.name ?? String(x.id) })), users: users.map(x => ({ id: String(x.id), name: x.login ?? String(x.id) })) };
  }
}
