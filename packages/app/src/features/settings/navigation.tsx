import { Link } from "@tanstack/react-router";
export function SettingsNavigation() { return <nav aria-label="Settings" className="my-4 flex flex-wrap gap-4"><Link to="/settings">Integrations</Link><Link to="/settings/api-keys">API keys</Link><Link to="/settings/authorized-clients">Authorized clients</Link><Link to="/settings/password">Change password</Link></nav>; }
