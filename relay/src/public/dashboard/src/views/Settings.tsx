import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import './Settings.css'

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
    <div className="settings-page">
      {/* Authentication */}
      <div className="settings-section card">
        <h3>🔐 Authentication</h3>
        {isAuthenticated ? (
          <div className="settings-auth-status">
            <div className="settings-auth-badge success">
              <span className="status-dot online"></span>
              <span>Authenticated</span>
            </div>
            <p>You have full access to all dashboard features.</p>
            <button className="btn btn-secondary" onClick={logout}>
              Logout
            </button>
          </div>
        ) : (
          <div className="settings-auth-form">
            <p>Enter admin password to unlock all features:</p>
            <div className="settings-auth-row">
              <input
                type="password"
                className="input"
                placeholder="Admin password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              />
              <button className="btn btn-primary" onClick={handleLogin}>
                Authenticate
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Theme */}
      <div className="settings-section card">
        <h3>🎨 Appearance</h3>
        <div className="settings-theme">
          <label className="settings-label">Theme</label>
          <div className="settings-theme-options">
            <button
              className={`settings-theme-btn ${theme === 'light' ? 'active' : ''}`}
              onClick={() => setTheme('light')}
            >
              ☀️ Light
            </button>
            <button
              className={`settings-theme-btn ${theme === 'dark' ? 'active' : ''}`}
              onClick={() => setTheme('dark')}
            >
              🌙 Dark
            </button>
          </div>
        </div>
      </div>


      {/* About */}
      <div className="settings-section card">
        <h3>ℹ️ About</h3>
        <p className="settings-about">
          Shogun Relay Dashboard — Part of the{' '}
          <a href="https://github.com/scobru/shogun" target="_blank" rel="noopener noreferrer">
            Shogun Project
          </a>
        </p>
      </div>
    </div>
  )
}

export default Settings
