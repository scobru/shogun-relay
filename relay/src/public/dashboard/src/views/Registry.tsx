import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './Registry.css'

interface RegistryConfig {
  chainId: string
  chainName: string
  explorerUrl: string
  registryAddress?: string
}

interface RelayStatus {
  configured: boolean
  registered: boolean
  relayAddress: string
  registryAddress?: string
  relay?: {
    status: string
    endpoint: string
    registeredAt: string
    totalDeals: number
    stakedAmount: string
    totalSlashed: string
  }
}

interface Balances {
  eth: string
  usdc: string
}

interface RegistryParams {
  minStake: string
  unstakingDelayDays: number
}

interface Deal {
  dealId: string
  cid: string
  client: string
  sizeMB: number
  priceUSDC: string
  active: boolean
  griefed: boolean
}

function Registry() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [config, setConfig] = useState<RegistryConfig | null>(null)
  const [status, setStatus] = useState<RelayStatus | null>(null)
  const [balances, setBalances] = useState<Balances | null>(null)
  const [params, setParams] = useState<RegistryParams | null>(null)
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)

  // Form states
  const [endpoint, setEndpoint] = useState('')
  const [gunPubKey, setGunPubKey] = useState('')
  const [stakeAmount, setStakeAmount] = useState('100')
  const [actionStatus, setActionStatus] = useState('')

  const truncateAddress = (addr: string) => 
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : ''

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      // Config
      const configRes = await fetch('/api/v1/registry/config')
      const configData = await configRes.json()
      setConfig(configData)

      // Status
      const statusRes = await fetch('/api/v1/registry/status')
      const statusData = await statusRes.json()
      setStatus(statusData)

      // Balances
      try {
        const balRes = await fetch('/api/v1/registry/balance')
        const balData = await balRes.json()
        if (balData.success) {
          setBalances(balData.balances)
        }
      } catch {}

      // Params
      try {
        const paramsRes = await fetch('/api/v1/registry/params')
        const paramsData = await paramsRes.json()
        if (paramsData.success) {
          setParams(paramsData.params)
        }
      } catch {}

      // Deals
      try {
        const dealsRes = await fetch('/api/v1/registry/deals')
        const dealsData = await dealsRes.json()
        if (dealsData.success) {
          setDeals(dealsData.deals || [])
        }
      } catch {}

    } catch (error) {
      console.error('Failed to fetch registry data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchServerKey = async () => {
    try {
      const res = await fetch('/health')
      const data = await res.json()
      if (data.relay?.pub) {
        setGunPubKey(data.relay.pub)
        setActionStatus('✅ Server key loaded')
      }
    } catch (error) {
      setActionStatus('❌ Failed to load server key')
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      fetchAll()
    } else {
      setLoading(false)
    }
  }, [isAuthenticated, fetchAll])

  const registerRelay = async () => {
    if (!endpoint || !gunPubKey || !stakeAmount) {
      setActionStatus('❌ Fill all fields')
      return
    }
    setActionStatus('Registering...')
    try {
      const res = await fetch('/api/v1/registry/register', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, gunPubKey, stakeAmount: parseFloat(stakeAmount) })
      })
      const data = await res.json()
      if (data.success) {
        setActionStatus('✅ Registered! ' + (data.txHash ? `TX: ${data.txHash.slice(0, 10)}...` : ''))
        fetchAll()
      } else {
        setActionStatus('❌ ' + (data.error || 'Failed'))
      }
    } catch {
      setActionStatus('❌ Network error')
    }
  }

  const getStatusBadgeClass = () => {
    if (!status?.configured) return 'status-not-configured'
    if (!status?.registered) return 'status-inactive'
    const s = status.relay?.status?.toLowerCase()
    if (s === 'active') return 'status-active'
    if (s === 'unstaking') return 'status-unstaking'
    if (s === 'slashed') return 'status-slashed'
    return 'status-inactive'
  }

  if (!isAuthenticated) {
    return (
      <div className="registry-auth card">
        <span className="registry-auth-icon">🔒</span>
        <h3>Authentication Required</h3>
        <p>Please enter admin password in Settings to access registry.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="registry-loading card">
        <div className="spinner"></div>
        <span>Loading registry data...</span>
      </div>
    )
  }

  return (
    <div className="registry-page">
      {/* Header */}
      <div className="registry-header card">
        <div>
          <h2>🛡️ Relay Registry</h2>
          <p>On-chain relay management and staking</p>
        </div>
        <span className="registry-chain-badge">
          {config?.chainName || 'Loading'} ({config?.chainId || '-'})
        </span>
      </div>

      <div className="registry-grid">
        {/* Server Key */}
        <div className="card registry-section">
          <h3>Server Relay Key</h3>
          <button className="btn btn-secondary" onClick={fetchServerKey}>
            Use Server Key
          </button>
          <p className="registry-hint">Auto-fill GunDB public key from server</p>
        </div>

        {/* Status */}
        <div className="card registry-section">
          <div className="registry-section-header">
            <h3>Registration Status</h3>
            <span className={`registry-status-badge ${getStatusBadgeClass()}`}>
              {!status?.configured ? 'Not Configured' :
               !status?.registered ? 'Not Registered' :
               status.relay?.status || 'Unknown'}
            </span>
          </div>

          {status?.configured && status?.registered && status.relay && (
            <div className="registry-info-list">
              <div className="registry-info-item">
                <span>Address</span>
                <span className="mono">{truncateAddress(status.relayAddress)}</span>
              </div>
              <div className="registry-info-item">
                <span>Endpoint</span>
                <span>{status.relay.endpoint}</span>
              </div>
              <div className="registry-info-item">
                <span>Registered</span>
                <span>{new Date(status.relay.registeredAt).toLocaleDateString()}</span>
              </div>
              <div className="registry-info-item">
                <span>Total Deals</span>
                <span>{status.relay.totalDeals ?? 0}</span>
              </div>
            </div>
          )}

          {!status?.configured && (
            <div className="registry-alert warning">
              RELAY_PRIVATE_KEY not configured. Set it in your .env file.
            </div>
          )}
        </div>

        {/* Balances */}
        <div className="card registry-section">
          <h3>Wallet Balances</h3>
          {balances ? (
            <div className="registry-balances">
              <div className="registry-balance">
                <span className="registry-balance-value">{parseFloat(balances.eth).toFixed(4)}</span>
                <span className="registry-balance-label">ETH (Gas)</span>
              </div>
              <div className="registry-balance">
                <span className="registry-balance-value">{parseFloat(balances.usdc).toFixed(2)}</span>
                <span className="registry-balance-label">USDC (Stake)</span>
              </div>
            </div>
          ) : (
            <p className="registry-hint">Unable to load balances</p>
          )}
        </div>

        {/* Registry Params */}
        <div className="card registry-section">
          <h3>Registry Parameters</h3>
          {params ? (
            <div className="registry-info-list">
              <div className="registry-info-item">
                <span>Minimum Stake</span>
                <span>{params.minStake} USDC</span>
              </div>
              <div className="registry-info-item">
                <span>Unstaking Delay</span>
                <span>{params.unstakingDelayDays} days</span>
              </div>
            </div>
          ) : (
            <p className="registry-hint">Loading params...</p>
          )}
        </div>

        {/* Register Form (only if not registered) */}
        {status?.configured && !status?.registered && (
          <div className="card registry-section full-width">
            <h3>Register Relay</h3>
            <div className="registry-form">
              <div className="registry-form-group">
                <label>Endpoint URL</label>
                <input
                  type="text"
                  className="input"
                  placeholder="https://your-relay.com"
                  value={endpoint}
                  onChange={e => setEndpoint(e.target.value)}
                />
              </div>
              <div className="registry-form-group">
                <label>GunDB Public Key</label>
                <input
                  type="text"
                  className="input"
                  placeholder="GunDB pub key"
                  value={gunPubKey}
                  onChange={e => setGunPubKey(e.target.value)}
                />
              </div>
              <div className="registry-form-group">
                <label>Stake Amount (USDC)</label>
                <input
                  type="number"
                  className="input"
                  value={stakeAmount}
                  onChange={e => setStakeAmount(e.target.value)}
                  min="0"
                  step="0.01"
                />
              </div>
              <button className="btn btn-primary" onClick={registerRelay}>
                Register On-Chain
              </button>
              {actionStatus && <p className="registry-action-status">{actionStatus}</p>}
            </div>
          </div>
        )}

        {/* Staking (only if registered) */}
        {status?.registered && status.relay && (
          <div className="card registry-section">
            <h3>Stake Management</h3>
            <div className="registry-balances">
              <div className="registry-balance">
                <span className="registry-balance-value">{status.relay.stakedAmount}</span>
                <span className="registry-balance-label">Current Stake (USDC)</span>
              </div>
              <div className="registry-balance">
                <span className="registry-balance-value" style={{ color: 'var(--color-warning)' }}>
                  {status.relay.totalSlashed}
                </span>
                <span className="registry-balance-label">Total Slashed (USDC)</span>
              </div>
            </div>
          </div>
        )}

        {/* Deals (only if registered) */}
        {status?.registered && deals.length > 0 && (
          <div className="card registry-section full-width">
            <h3>On-Chain Deals</h3>
            <div className="registry-deals-stats">
              <div>Total: <strong>{deals.length}</strong></div>
              <div>Active: <strong>{deals.filter(d => d.active && !d.griefed).length}</strong></div>
              <div>Revenue: <strong>{deals.reduce((s, d) => s + parseFloat(d.priceUSDC || '0'), 0).toFixed(4)} USDC</strong></div>
            </div>
            <div className="registry-deals-list">
              <table className="registry-table">
                <thead>
                  <tr>
                    <th>CID</th>
                    <th>Client</th>
                    <th>Size</th>
                    <th>Price</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deals.slice(0, 10).map(d => (
                    <tr key={d.dealId}>
                      <td className="mono" title={d.cid}>{d.cid.slice(0, 10)}...</td>
                      <td className="mono">{truncateAddress(d.client)}</td>
                      <td>{d.sizeMB} MB</td>
                      <td><strong>{d.priceUSDC} USDC</strong></td>
                      <td>
                        {d.griefed ? <span className="text-error">⚠️ Griefed</span> :
                         d.active ? <span className="text-success">✅ Active</span> :
                         <span className="text-muted">⏸️ Inactive</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Registry
