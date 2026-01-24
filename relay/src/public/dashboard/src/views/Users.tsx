
import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

interface User {
  pub: string;
  alias: string;
  lastSeen: number;
  registeredAt: number;
}

function Users() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/users', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success && data.users) setUsers(data.users)
    } catch (error) { console.error('Failed to load users:', error) }
    finally { setLoading(false) }
  }, [getAuthHeaders])

  useEffect(() => { if (isAuthenticated) loadUsers(); else setLoading(false) }, [isAuthenticated, loadUsers])

  const formatDate = (ts: number) => new Date(ts).toLocaleString()
  const formatTimeAgo = (ts: number) => {
    const seconds = Math.floor((Date.now() - ts) / 1000)
    if (seconds < 60) return 'Just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  }

  if (!isAuthenticated) {
    return <div className="alert alert-warning"><span className="text-2xl">🔒</span><div><h3 className="font-bold">Authentication Required</h3><p>Enter admin password in Settings to view users.</p></div></div>
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Header */}
      <div className="card bg-base-100 shadow">
        <div className="card-body flex-row items-center justify-between">
          <div>
            <h2 className="card-title">👥 Users</h2>
            <p className="text-base-content/60">Observed users on this relay</p>
          </div>
          <button className="btn btn-ghost btn-circle" onClick={loadUsers}>
            <span className="text-xl">↻</span>
          </button>
        </div>
      </div>

      {/* Users List */}
      {loading ? (
        <div className="flex justify-center p-8"><span className="loading loading-spinner loading-lg"></span></div>
      ) : users.length === 0 ? (
        <div className="card bg-base-100 shadow">
          <div className="card-body items-center text-center">
            <span className="text-4xl">👥</span>
            <h3 className="card-title">No Users Observed</h3>
            <p className="text-base-content/60">No users have authenticated with this relay yet.</p>
          </div>
        </div>
      ) : (
        <div className="card bg-base-100 shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>Alias</th>
                  <th>Public Key</th>
                  <th>Last Seen</th>
                  <th>First Seen</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.pub}>
                    <td className="font-bold">{user.alias}</td>
                    <td className="font-mono text-xs opacity-70">
                      <div className="tooltip" data-tip={user.pub}>
                        {user.pub.substring(0, 10)}...{user.pub.substring(user.pub.length - 8)}
                      </div>
                      <button 
                        className="btn btn-ghost btn-xs ml-2" 
                        onClick={() => navigator.clipboard.writeText(user.pub)}
                        title="Copy Public Key"
                      >
                        📋
                      </button>
                    </td>
                    <td>
                      <div className="flex flex-col">
                        <span>{formatTimeAgo(user.lastSeen)}</span>
                        <span className="text-xs opacity-50">{formatDate(user.lastSeen)}</span>
                      </div>
                    </td>
                    <td className="text-xs opacity-70">{formatDate(user.registeredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default Users
