import { describe, expect, it } from "vitest";
import { LINEAR_OPTION_QUERIES, LINEAR_PROJECTS_QUERY } from "../src/linear";

describe("Linear queries", () => {
  it("keeps the projects lookup small and unnested", () => {
    expect(LINEAR_PROJECTS_QUERY).toContain("projects(first: 50)");
    expect(LINEAR_PROJECTS_QUERY).toContain("id name");
    expect(LINEAR_PROJECTS_QUERY).not.toContain("teams");
    expect(LINEAR_PROJECTS_QUERY).not.toContain("first: 250");
  });

  it("splits trigger options into simple independent queries", () => {
    expect(Object.values(LINEAR_OPTION_QUERIES)).toHaveLength(3);
    for (const query of Object.values(LINEAR_OPTION_QUERIES)) {
      expect(query.match(/first:/g)).toHaveLength(1);
      expect(query).not.toContain("projects");
    }
  });
});
