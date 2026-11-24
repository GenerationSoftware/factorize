export type NavIconName =
  | "triggers" | "settings" | "skills"
  | "integrations" | "key" | "users" | "lock";

const paths: Record<NavIconName, React.ReactNode> = {
  triggers: <><rect x="3.5" y="7" width="17" height="13.5" rx="2"/><path strokeLinecap="round" strokeLinejoin="round" d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M3.5 12h17m-10 0v1.5h3V12"/></>,
  settings: <><path strokeLinecap="round" strokeLinejoin="round" d="M10 3.8h4l.6 2.1 1.6.9 2.1-.6 2 3.5-1.5 1.6v1.8l1.5 1.6-2 3.5-2.1-.6-1.6.9-.6 2.1h-4l-.6-2.1-1.6-.9-2.1.6-2-3.5 1.5-1.6v-1.8L3.7 9.7l2-3.5 2.1.6 1.6-.9z"/><circle cx="12" cy="12" r="3"/></>,
  skills: <><path strokeLinecap="round" strokeLinejoin="round" d="m12 3 2.1 5.9L20 11l-5.9 2.1L12 19l-2.1-5.9L4 11l5.9-2.1zM19 16v5m-2.5-2.5h5"/></>,
  integrations: <><rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  key: <><circle cx="8" cy="15" r="4"/><path strokeLinecap="round" strokeLinejoin="round" d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-2 2"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path strokeLinecap="round" strokeLinejoin="round" d="M3 20v-1a6 6 0 0 1 12 0v1zm12-12a3 3 0 1 1 0 6m2 1a5 5 0 0 1 4 5"/></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path strokeLinecap="round" strokeLinejoin="round" d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/></>,
};

export function NavIcon({ name, className = "size-[18px]" }: { name: NavIconName; className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>{paths[name]}</svg>;
}
