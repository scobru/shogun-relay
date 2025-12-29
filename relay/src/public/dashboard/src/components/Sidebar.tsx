import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import './Sidebar.css'

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
  { path: '/torrents', icon: '📥', label: 'Torrents', group: 'blockchain' },
  { path: '/api-keys', icon: '🔑', label: 'API Keys', group: 'tools' },
  { path: '/charts', icon: '📉', label: 'Charts', group: 'tools' },
  { path: '/visual-graph', icon: '🕸️', label: 'Visual Graph', group: 'tools' },
  { path: '/graph-explorer', icon: '🔍', label: 'Graph Explorer', group: 'tools' },
  { path: '/rpc-console', icon: '💻', label: 'RPC Console', group: 'tools' },
  { path: '/api-docs', icon: '📄', label: 'API Docs', group: 'tools' },
  { path: '/settings', icon: '⚙️', label: 'Settings', group: 'system' },
]

function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false)

  const renderNavGroup = (groupName: string) => {
    const items = navItems.filter(item => item.group === groupName)
    return items.map((item) => (
      <NavLink
        key={item.path}
        to={item.path}
        className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
        title={item.label}
        end={item.path === '/'}
      >
        <span className="sidebar-icon">{item.icon}</span>
        <span className="sidebar-label">{item.label}</span>
      </NavLink>
    ))
  }

  return (
    <aside 
      className={`sidebar ${isExpanded ? 'expanded' : ''}`}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      {/* Logo */}
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">⚡</span>
          <span className="sidebar-logo-text">SHOGUN</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="sidebar-group">
          {renderNavGroup('main')}
        </div>
        
        <div className="sidebar-divider"></div>
        
        <div className="sidebar-group">
          {renderNavGroup('storage')}
        </div>
        
        <div className="sidebar-divider"></div>
        
        <div className="sidebar-group">
          {renderNavGroup('blockchain')}
        </div>
        
        <div className="sidebar-divider"></div>
        
        <div className="sidebar-group">
          {renderNavGroup('tools')}
        </div>
        
        <div className="sidebar-divider"></div>
        
        <div className="sidebar-group">
          {renderNavGroup('system')}
        </div>
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <a 
          href="https://github.com/scobru/shogun" 
          target="_blank" 
          rel="noopener noreferrer"
          className="sidebar-link"
          title="GitHub"
        >
          <span className="sidebar-icon">📦</span>
          <span className="sidebar-label">GitHub</span>
        </a>
      </div>
    </aside>
  )
}

export default Sidebar
