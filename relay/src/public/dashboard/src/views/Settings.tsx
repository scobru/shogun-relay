import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

function Settings() {
  const { isAuthenticated, login, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const [newPassword, setNewPassword] = useState('')

  const handleLogin = () => {
    if (newPassword.trim()) {
      login(newPassword.trim())
      setNewPassword('')
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Authentication */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title">🔐 Authentication</h3>
          {isAuthenticated ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <div className="badge badge-success gap-2">
                  <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
                  Authenticated
                </div>
              </div>
              <p className="text-base-content/70">You have full access to all dashboard features.</p>
              <button className="btn btn-outline btn-error w-fit" onClick={logout}>
                🔓 Logout
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-base-content/70">Enter admin password to unlock all features:</p>
              <div className="join w-full">
                <input
                  type="password"
                  className="input input-bordered join-item flex-1"
                  placeholder="Admin password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                />
                <button className="btn btn-primary join-item" onClick={handleLogin}>
                  🔑 Authenticate
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Theme */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title">🎨 Appearance</h3>
          <div className="form-control">
            <label className="label">
              <span className="label-text">Theme</span>
            </label>
            <div className="join">
              <button
                className={`btn join-item ${theme === 'light' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTheme('light')}
              >
                ☀️ Light
              </button>
              <button
                className={`btn join-item ${theme === 'dark' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTheme('dark')}
              >
                🌙 Dark
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title">ℹ️ About</h3>
          <p className="text-base-content/70">
            Shogun Relay Dashboard — Part of the{' '}
            <a href="https://github.com/scobru/shogun" target="_blank" rel="noopener noreferrer" className="link link-primary">
              Shogun Project
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

export default Settings
