/** Kept separate so query cost and shape can be tested without a live Linear workspace. */
export const LINEAR_PROJECTS_QUERY = "query { projects(first: 50) { nodes { id name } } }";

/** IssueLabel webhook records contain IDs, but not always the linked issue details. */
export const LINEAR_ISSUE_PROJECT_QUERY = "query($id:String!){ issue(id:$id){ id identifier url title description project { id name } labels { nodes { id name } } assignee { id name } creator { id name } state { id name } } }";

export const LINEAR_OPTION_QUERIES = {
  statuses: "query { workflowStates(first: 100) { nodes { id name } } }",
  users: "query { users(first: 100) { nodes { id name } } }",
  labels: "query { issueLabels(first: 100) { nodes { id name } } }",
} as const;

type LinearError = { message?: string; extensions?: { code?: string } };

export const isLinearAuthenticationError = (status: number, errors: LinearError[] | undefined): boolean => {
  if (status === 401) return true;
  return Boolean(errors?.some(error => {
    const code = error.extensions?.code?.toUpperCase();
    if (code === "UNAUTHENTICATED" || code === "AUTHENTICATION_ERROR") return true;
    return /authentication required|not authenticated|access token.*(?:invalid|expired)|(?:invalid|expired).*access token/i.test(error.message ?? "");
  }));
};

export const refreshLinearToken = async (refreshToken: string, clientId: string, clientSecret: string): Promise<{ access_token: string; refresh_token?: string }> => {
  const response = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
  });
  const tokens = await response.json() as { access_token?: string; refresh_token?: string };
  if (!response.ok || !tokens.access_token) throw new Error("Your Linear connection expired. Reconnect Linear to continue.");
  return { access_token: tokens.access_token, refresh_token: tokens.refresh_token };
};
