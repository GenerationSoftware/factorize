/** Kept separate so query cost and shape can be tested without a live Linear workspace. */
export const LINEAR_PROJECTS_QUERY = "query { projects(first: 50) { nodes { id name } } }";

/** IssueLabel webhook records contain IDs, but not always the linked issue details. */
export const LINEAR_ISSUE_PROJECT_QUERY = "query($id:String!){ issue(id:$id){ id identifier url title description project { id name } labels { nodes { id name } } assignee { id name } creator { id name } state { id name } } }";

export const LINEAR_OPTION_QUERIES = {
  statuses: "query { workflowStates(first: 100) { nodes { id name } } }",
  users: "query { users(first: 100) { nodes { id name } } }",
  labels: "query { issueLabels(first: 100) { nodes { id name } } }",
} as const;
