import { teamQuery } from "./team-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Page, PageHeader } from "../../shared/ui";
import { TeamRunDefaults } from "./team-run-defaults";


export function TeamSettings() {
  const team = useQuery(teamQuery);
  return <Page>
    <PageHeader title="Team settings" />
    <Link to="/settings/vm-presets" className="font-semibold underline">VM presets</Link>
    {team.isPending && <p role="status">Loading team settings…</p>}
    {team.error && <p role="alert">{team.error.message}</p>}
    {team.data && <TeamRunDefaults initial={team.data.runDefaults} />}
  </Page>;
}
