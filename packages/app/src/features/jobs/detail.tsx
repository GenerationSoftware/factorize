import { Page } from "../../shared/ui";
import { TriggerActions } from "./header";
import { RunHistory } from "../runs/history";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { triggerQuery } from "./queries";
import { TriggerNav } from "./job-nav";
export function TriggerDetail() {
  const { triggerId } = useParams({ strict: false });
  const query = useQuery(triggerQuery(triggerId!));
  const trigger = query.data;
  return <>{trigger && <TriggerNav triggerId={trigger.id} tab="runs" />}<Page className="pt-6 sm:pt-8">
    {query.isPending && <p role="status">Loading trigger…</p>}{query.error && <p role="alert">{query.error.message}</p>}
    {trigger && <><TriggerActions trigger={trigger} /><div className="mb-6"><RunHistory triggerId={trigger.id} /></div></>}
  </Page></>;
}
