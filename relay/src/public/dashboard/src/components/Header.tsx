import { useLocation } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import './Header.css'

const pageTitles: Record<string, { title: string; description: string }> = {
  '/': { title: 'Status', description: 'Overview and system health' },
  '/stats': { title: 'Live Stats', description: 'Real-time metrics and monitoring' },
  '/services': { title: 'Services', description: 'Monitor and control system services' },
  '/files': { title: 'Files', description: 'IPFS pin management and uploads' },
  '/drive': { title: 'Drive', description: 'Private file storage' },
  '/explore': { title: 'Explore', description: 'Graph explorer and visualization' },
  '/network': { title: 'Network', description: 'Network statistics and peers' },
  '/registry': { title: 'Registry', description: 'On-chain registry dashboard' },
  '/torrents': { title: 'Torrents', description: 'Torrent manager and seeding' },
  '/settings': { title: 'Settings', description: 'API keys and configuration' },
}

function Header() {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const { isAuthenticated, logout } = useAuth()

  const pageInfo = pageTitles[location.pathname] || { title: 'Dashboard', description: '' }

  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">{pageInfo.title}</h1>
        <p className="header-description">{pageInfo.description}</p>
      </div>

      <div className="header-right">
        {/* Status indicator */}
        <div className="header-status">
          <span className="status-dot online"></span>
          <span className="header-status-text">Online</span>
        </div>

        {/* Theme toggle */}
        <button 
          className="header-btn"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        {/* Auth status */}
        {isAuthenticated ? (
          <button className="header-btn header-btn-auth" onClick={logout} title="Logout">
            🔓
          </button>
        ) : (
          <span className="header-auth-badge">🔒 Limited Access</span>
        )}
      </div>
    </header>
  )
}

export default Header
