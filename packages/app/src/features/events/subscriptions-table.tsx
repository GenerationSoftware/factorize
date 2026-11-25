import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Table, tableCellClasses, tableHeadClasses, tableRowClasses } from "../../shared/ui";
import { clientsQuery } from "../settings/queries";
import { subscriptionsQuery, type EventSubscription } from "./queries";

export const subscriptionStatus: Record<EventSubscription["status"], string> = {
  active: "Active", expired: "Expired", stopped: "Stopped",
};

export function SubscriptionTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}

export function EventSubscriptions({ eventId, grantId }: { eventId?: string; grantId?: string }) {
  const subscriptions = useQuery(subscriptionsQuery);
  if (subscriptions.isPending) return <p role="status">Loading subscriptions…</p>;
  if (subscriptions.error) return <p role="alert">{subscriptions.error.message}</p>;
  return <SubscriptionsTable showClient={!grantId} rows={subscriptions.data.filter(row =>
    (!eventId || row.eventId === eventId) && (!grantId || row.grantId === grantId))} />;
}

export function SubscriptionsTable({ rows, showClient = true, detail = false }: { rows: EventSubscription[]; showClient?: boolean; detail?: boolean }) {
  const clients = useQuery({ ...clientsQuery, enabled: showClient && rows.length > 0 });
  if (!rows.length) return <p>No subscriptions yet.</p>;
  const connections = new Map(clients.data?.map(client => [client.grantId, client.clientName]));
  return <>
    {showClient && clients.error && <p role="alert">Connection names could not be loaded.</p>}
    <Table aria-label="Event subscriptions">
      <thead className={tableHeadClasses}><tr>
        {[...(showClient ? ["Client"] : []), "Event", "Status", "Acknowledgment mode", "Expires", "Cooldown ends"].map(label =>
          <th key={label} scope="col" className={tableCellClasses}>{label}</th>)}
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} className={tableRowClasses}>
        {showClient && <td className={tableCellClasses}>{connections.has(row.grantId)
          ? <Link className="underline" to="/clients/$grantId" params={{ grantId: row.grantId }}>{connections.get(row.grantId)}</Link>
          : clients.isPending ? "Loading…" : "Unavailable connection"}</td>}
        <th scope="row" className={`${tableCellClasses} font-medium`}>
          {detail
            ? <Link className="underline" to="/events/$eventId" params={{ eventId: row.eventId }}>{row.eventName}</Link>
            : <Link className="underline" to="/events/subscriptions/$subscriptionId" params={{ subscriptionId: row.id }}>{row.eventName}<span className="sr-only"> subscription ending in {row.id.slice(-8)}</span></Link>}
        </th>
        <td className={tableCellClasses}>{subscriptionStatus[row.status]}</td>
        <td className={tableCellClasses}>{row.acknowledgmentMode === "required" ? "Required" : "Off"}</td>
        <td className={`${tableCellClasses} whitespace-nowrap`}><SubscriptionTime value={row.expiresAt} /></td>
        <td className={`${tableCellClasses} whitespace-nowrap`}>{row.lastCooldownEndsAt
          ? <SubscriptionTime value={row.lastCooldownEndsAt} /> : "Not recorded"}</td>
      </tr>)}</tbody>
    </Table>
  </>;
}
