export type NavIconName =
  | "jobs" | "runs" | "settings" | "projects" | "skills"
  | "integrations" | "key" | "users" | "lock"
  | "general" | "execution" | "context" | "permissions" | "triggers"
  | "trace" | "info";

const paths: Record<NavIconName, React.ReactNode> = {
  jobs: <><rect x="3.5" y="7" width="17" height="13.5" rx="2"/><path strokeLinecap="round" strokeLinejoin="round" d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M3.5 12h17m-10 0v1.5h3V12"/></>,
  runs: <><circle cx="12" cy="12" r="9"/><path fill="currentColor" stroke="none" d="m10 8 6 4-6 4z"/></>,
  settings: <><path strokeLinecap="round" strokeLinejoin="round" d="M10 3.8h4l.6 2.1 1.6.9 2.1-.6 2 3.5-1.5 1.6v1.8l1.5 1.6-2 3.5-2.1-.6-1.6.9-.6 2.1h-4l-.6-2.1-1.6-.9-2.1.6-2-3.5 1.5-1.6v-1.8L3.7 9.7l2-3.5 2.1.6 1.6-.9z"/><circle cx="12" cy="12" r="3"/></>,
  projects: <><rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/></>,
  skills: <><path strokeLinecap="round" strokeLinejoin="round" d="m12 3 2.1 5.9L20 11l-5.9 2.1L12 19l-2.1-5.9L4 11l5.9-2.1zM19 16v5m-2.5-2.5h5"/></>,
  integrations: <><rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  key: <><circle cx="8" cy="15" r="4"/><path strokeLinecap="round" strokeLinejoin="round" d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-2 2"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path strokeLinecap="round" strokeLinejoin="round" d="M3 20v-1a6 6 0 0 1 12 0v1zm12-12a3 3 0 1 1 0 6m2 1a5 5 0 0 1 4 5"/></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path strokeLinecap="round" strokeLinejoin="round" d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/></>,
  general: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path strokeLinecap="round" strokeLinejoin="round" d="M6.5 19a6 6 0 0 1 11 0"/></>,
  execution: <><path strokeLinecap="round" strokeLinejoin="round" d="M13 2 4 14h7l-1 8 10-13h-7z"/></>,
  context: <><path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16M4 12h16M4 19h10"/><circle cx="18" cy="19" r="2"/></>,
  permissions: <><path strokeLinecap="round" strokeLinejoin="round" d="M12 3 20 6v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/><path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4"/></>,
  triggers: <><path strokeLinecap="round" strokeLinejoin="round" d="M12 3 4 13h6l-1 8 11-12h-6z"/></>,
  trace: <><path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l3-7 4 14 3-7h4"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 11v5m0-8h.01"/></>,
};

export function NavIcon({ name, className = "size-[18px]" }: { name: NavIconName; className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>{paths[name]}</svg>;
}
