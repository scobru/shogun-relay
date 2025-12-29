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

function Sidebar() {
  const groups = ['main', 'storage', 'blockchain', 'tools', 'system']

  return (
    <div className="drawer-side z-40">
      <label htmlFor="main-drawer" aria-label="close sidebar" className="drawer-overlay"></label>
      <aside className="bg-base-300 min-h-screen w-64 flex flex-col">
        {/* Logo */}
        <div className="p-4 flex items-center gap-2 border-b border-base-content/10">
          <span className="text-2xl">⚡</span>
          <span className="font-bold text-xl">SHOGUN</span>
        </div>

        {/* Navigation */}
        <ul className="menu menu-md flex-1 p-2 overflow-y-auto">
          {groups.map((group) => (
            <li key={group}>
              <h2 className="menu-title">{groupLabels[group]}</h2>
              <ul>
                {navItems
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        className={({ isActive }) => isActive ? 'active' : ''}
                        end={item.path === '/'}
                      >
                        <span>{item.icon}</span>
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>

        {/* Footer */}
        <div className="p-4 border-t border-base-content/10">
          <a
            href="https://github.com/scobru/shogun"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm w-full justify-start gap-2"
          >
            <span>📦</span>
            GitHub
          </a>
        </div>
      </aside>
    </div>
  )
}

export default Sidebar
