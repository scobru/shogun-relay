import { NavLink } from "react-router-dom";
import logoSvg from "./logo.svg";

// Using Lucide-style icon names for professional look
const iconMap: Record<string, string> = {
  status: "◉",
  stats: "▤",
  files: "▢",
  drive: "◫",
  network: "◇",
  apiKeys: "◈",
  charts: "▦",
  visualGraph: "◬",
  graphExplorer: "◎",
  apiDocs: "▤",
  settings: "◎",
};

interface NavItem {
  path: string;
  icon: string;
  label: string;
  group?: string;
}

const navItems: NavItem[] = [
  { path: "/", icon: iconMap.status, label: "Status", group: "main" },
  { path: "/stats", icon: iconMap.stats, label: "Live Stats", group: "main" },
  { path: "/files", icon: iconMap.files, label: "Files", group: "storage" },
  { path: "/drive", icon: iconMap.drive, label: "Drive", group: "storage" },
  { path: "/network", icon: iconMap.network, label: "Network", group: "network" },
  { path: "/api-keys", icon: iconMap.apiKeys, label: "API Keys", group: "tools" },
  { path: "/charts", icon: iconMap.charts, label: "Charts", group: "tools" },
  { path: "/visual-graph", icon: iconMap.visualGraph, label: "Visual Graph", group: "tools" },
  { path: "/graph-explorer", icon: iconMap.graphExplorer, label: "Graph Explorer", group: "tools" },
  { path: "/api-docs", icon: iconMap.apiDocs, label: "API Docs", group: "tools" },
  { path: "/settings", icon: iconMap.settings, label: "Settings", group: "system" },
];

const groupLabels: Record<string, string> = {
  main: "DASHBOARD",
  storage: "STORAGE",
  network: "NETWORK",
  tools: "TOOLS",
  system: "SYSTEM",
};

function Sidebar() {
  const groups = ["main", "storage", "network", "tools", "system"];

  return (
    <div className="drawer-side z-40">
      <label htmlFor="main-drawer" aria-label="close sidebar" className="drawer-overlay"></label>
      <aside className="bg-base-200 min-h-screen w-64 flex flex-col border-r border-base-300">
        {/* Logo */}
        <div className="p-4 flex items-center gap-3 bg-base-300">
          <img src={logoSvg} alt="Shogun Relay" className="w-10 h-10" />
          <div>
            <span className="font-bold text-lg">Relay</span>
            <p className="text-xs text-base-content/60">Relay Dashboard v1.2.1-clean</p>
          </div>
        </div>

        {/* Navigation */}
        <ul className="menu menu-sm flex-1 p-2 gap-1 overflow-y-auto">
          {groups.map((group) => (
            <li key={group} className="mt-3 first:mt-0">
              <h2 className="menu-title text-xs uppercase tracking-wider opacity-50 font-semibold">
                {groupLabels[group]}
              </h2>
              <ul className="ml-0">
                {navItems
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        className={({ isActive }: { isActive: boolean }) =>
                          `flex items-center gap-3 rounded-lg transition-all ${isActive ? "bg-primary text-primary-content font-medium" : "hover:bg-base-300"}`
                        }
                        end={item.path === "/"}
                      >
                        <span className="text-sm opacity-70 w-4 text-center">{item.icon}</span>
                        <span className="text-sm">{item.label}</span>
                      </NavLink>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>

        {/* Footer */}
        <div className="p-3 border-t border-base-300 bg-base-300/50">
          <a
            href="https://github.com/scobru/shogun"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm w-full justify-start gap-2 text-base-content/70"
          >
            <span className="text-sm">GitHub</span>
          </a>
        </div>
      </aside>
    </div>
  );
}

export default Sidebar;
