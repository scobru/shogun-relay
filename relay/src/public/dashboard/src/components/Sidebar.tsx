import { NavLink } from 'react-router-dom'

interface NavItem {
  path: string
  icon: string
  label: string
  group?: string
}

const navItems: NavItem[] = [
  { path: '/', icon: '📊', label: 'Status', group: 'main' },
  { path: '/stats', icon: '📈', label: 'Live Stats', group: 'main' },
  { path: '/services', icon: '⚡', label: 'Services', group: 'main' },
  { path: '/files', icon: '📁', label: 'Files', group: 'storage' },
  { path: '/drive', icon: '💾', label: 'Drive', group: 'storage' },
  { path: '/explore', icon: '🔍', label: 'Explore', group: 'storage' },
  { path: '/network', icon: '🌐', label: 'Network', group: 'blockchain' },
  { path: '/chat', icon: '💬', label: 'Chat', group: 'blockchain' },
  { path: '/registry', icon: '🖥️', label: 'Registry', group: 'blockchain' },
  { path: '/deals', icon: '💼', label: 'Deals', group: 'blockchain' },
  { path: '/x402', icon: '💳', label: 'x402', group: 'blockchain' },
  { path: '/torrents', icon: '📥', label: 'Torrents', group: 'blockchain' },
  { path: '/api-keys', icon: '🔑', label: 'API Keys', group: 'tools' },
  { path: '/charts', icon: '📉', label: 'Charts', group: 'tools' },
  { path: '/visual-graph', icon: '🕸️', label: 'Visual Graph', group: 'tools' },
  { path: '/graph-explorer', icon: '🔍', label: 'Graph Explorer', group: 'tools' },
  { path: '/rpc-console', icon: '💻', label: 'RPC Console', group: 'tools' },
  { path: '/api-docs', icon: '📄', label: 'API Docs', group: 'tools' },
  { path: '/settings', icon: '⚙️', label: 'Settings', group: 'system' },
]

const groupLabels: Record<string, string> = {
  main: 'Dashboard',
  storage: 'Storage',
  blockchain: 'Blockchain',
  tools: 'Tools',
  system: 'System'
}

const groupIcons: Record<string, string> = {
  main: '🏠',
  storage: '💿',
  blockchain: '⛓️',
  tools: '🛠️',
  system: '⚙️'
}

function Sidebar() {
  const groups = ['main', 'storage', 'blockchain', 'tools', 'system']

  return (
    <div className="drawer-side z-40">
      <label htmlFor="main-drawer" aria-label="close sidebar" className="drawer-overlay"></label>
      <aside className="bg-base-200 min-h-screen w-64 flex flex-col border-r border-base-300">
        {/* Logo */}
        <div className="p-4 flex items-center gap-3 bg-base-300">
          <img src="./logo.svg" alt="Logo" className="w-10 h-10" />
          <div>
            <span className="font-bold text-lg">Relay</span>
            <p className="text-xs text-base-content/60">Relay Dashboard</p>
          </div>
        </div>

        {/* Navigation */}
        <ul className="menu menu-sm flex-1 p-2 gap-1 overflow-y-auto">
          {groups.map((group) => (
            <li key={group} className="mt-2 first:mt-0">
              <h2 className="menu-title flex items-center gap-2 text-xs uppercase tracking-wider opacity-60">
                <span>{groupIcons[group]}</span>
                {groupLabels[group]}
              </h2>
              <ul className="ml-1">
                {navItems
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        className={({ isActive }: { isActive: boolean }) => 
                          `flex items-center gap-2 rounded-lg transition-all ${isActive ? 'bg-primary text-primary-content font-medium' : 'hover:bg-base-300'}`
                        }
                        end={item.path === '/'}
                      >
                        <span className="text-base">{item.icon}</span>
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
            <span>📦</span>
            <span className="text-xs">View on GitHub</span>
          </a>
        </div>
      </aside>
    </div>
  )
}

export default Sidebar
