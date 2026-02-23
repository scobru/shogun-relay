import { useLocation } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'

const pageTitles: Record<string, { title: string; description: string }> = {
  '/': { title: 'Status', description: 'Overview and system health' },
  '/stats': { title: 'Live Stats', description: 'Real-time metrics and monitoring' },
  '/services': { title: 'Services', description: 'Monitor and control system services' },
  '/files': { title: 'Files', description: 'IPFS pin management and uploads' },
  '/drive': { title: 'Drive', description: 'Private file storage' },
  '/explore': { title: 'Explore', description: 'Graph explorer and visualization' },
  '/network': { title: 'Network', description: 'Network statistics and peers' },
  '/torrents': { title: 'Torrents', description: 'Torrent manager and seeding' },
  '/settings': { title: 'Settings', description: 'API keys and configuration' },
}

function Header() {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const { isAuthenticated, logout } = useAuth()

  const pageInfo = pageTitles[location.pathname] || { title: 'Dashboard', description: '' }

  return (
    <header className="navbar bg-base-100 border-b border-base-300 px-4 gap-2">
      {/* Mobile menu button */}
      <div className="flex-none lg:hidden">
        <label htmlFor="main-drawer" aria-label="Open sidebar" className="btn btn-square btn-ghost">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="inline-block w-5 h-5 stroke-current">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path>
          </svg>
        </label>
      </div>

      {/* Page title */}
      <div className="flex-1">
        <div>
          <h1 className="text-lg font-bold">{pageInfo.title}</h1>
          <p className="text-xs text-base-content/60">{pageInfo.description}</p>
        </div>
      </div>

      {/* Right side */}
      <div className="flex-none flex items-center gap-2">
        {/* Status badge */}
        <div className="badge badge-success gap-1">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
          Online
        </div>

        {/* Theme toggle */}
        <label className="swap swap-rotate btn btn-ghost btn-circle">
          <input 
            type="checkbox"
            aria-label="Toggle theme"
            className="theme-controller" 
            checked={theme === 'dark'}
            onChange={toggleTheme}
          />
          <svg className="swap-off fill-current w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"/>
          </svg>
          <svg className="swap-on fill-current w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z"/>
          </svg>
        </label>

        {/* Auth button */}
        {isAuthenticated ? (
          <button 
            className="btn btn-ghost btn-circle"
            onClick={logout} 
            title="Logout"
            aria-label="Logout"
          >
            🔓
          </button>
        ) : (
          <div className="badge badge-warning gap-1">
            🔒 Limited
          </div>
        )}
      </div>
    </header>
  )
}

export default Header
