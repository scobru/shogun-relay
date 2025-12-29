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
  const [stakeActionAmount, setStakeActionAmount] = useState('0')
  const [actionStatus, setActionStatus] = useState('')
  const [stakingMode, setStakingMode] = useState<'increase' | 'unstake' | 'withdraw'>('increase')

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
      
      // Pre-fill forms if registered
      if (statusData.relay) {
          setEndpoint(statusData.relay.endpoint)
      }

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
    if (!endpoint || !gunPubKey || !stakeActionAmount) {
      setActionStatus('❌ Fill all fields')
      return
    }
    setActionStatus('Registering...')
    try {
      const res = await fetch('/api/v1/registry/register', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, gunPubKey, stakeAmount: parseFloat(stakeActionAmount) })
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
  
  const updateRelay = async () => {
      // Logic for updating endpoint/keys 
      setActionStatus('Updating relay...')
      try {
        const res = await fetch('/api/v1/registry/update', { // Assuming endpoint exists or repurposed register
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint, gunPubKey })
        })
        const data = await res.json()
        if (data.success) {
            setActionStatus('✅ Updated!')
            fetchAll()
        } else {
            setActionStatus('❌ Update failed: ' + (data.error))
        }
      } catch {
          setActionStatus('❌ Network error')
      }
  }

  const handleStakingAction = async () => {
      const amount = parseFloat(stakeActionAmount)
      setActionStatus(`Processing ${stakingMode}...`)
      
      let endpointUrl = ''
      switch(stakingMode) {
          case 'increase': endpointUrl = '/api/v1/registry/stake/increase'; break;
          case 'unstake': endpointUrl = '/api/v1/registry/stake/unstake'; break;
          case 'withdraw': endpointUrl = '/api/v1/registry/stake/withdraw'; break;
      }
      
      try {
          const res = await fetch(endpointUrl, {
              method: 'POST',
              headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ amount })
          })
          const data = await res.json()
          if (data.success) {
              setActionStatus(`✅ ${stakingMode} success!`)
              fetchAll()
          } else {
              setActionStatus(`❌ ${stakingMode} failed: ${data.error}`)
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

  if (!isAuthenticated) return <div className="card"><h3>Authentication Required</h3></div>
  if (loading) return <div className="loading">Loading registry data...</div>

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
        {/* Status */}
        <div className="card registry-section">
          <div className="registry-section-header">
            <h3>Registration Status</h3>
            <span className={`registry-status-badge ${getStatusBadgeClass()}`}>
              {!status?.configured ? 'Not Configured' : !status?.registered ? 'Not Registered' : status.relay?.status || 'Unknown'}
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
        
        {/* Actions Zone */}
        {status?.configured && (
            <div className="card registry-section full-width">
                <h3>{status.registered ? 'Relay Management' : 'Register Relay'}</h3>
                
                {/* Registration / Update Form */}
                <div className="registry-form-row">
                    <div className="form-group">
                         <label>Endpoint URL</label>
                         <input type="text" className="input" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://..." />
                    </div>
                    {!status.registered && (
                        <div className="form-group">
                            <label>GunDB Pub Key</label>
                            <div className="input-with-btn">
                                <input type="text" className="input" value={gunPubKey} onChange={e => setGunPubKey(e.target.value)} />
                                <button className="btn btn-sm" onClick={fetchServerKey}>Fetch</button>
                            </div>
                        </div>
                    )}
                     <div className="form-group">
                        <label>{status.registered ? 'Update Info' : 'Initial Stake'}</label>
                        {status.registered ? (
                             <button className="btn btn-secondary" onClick={updateRelay}>Update Endpoint</button>
                        ) : (
                             <div className="input-with-btn">
                                <input type="number" className="input" value={stakeActionAmount} onChange={e => setStakeActionAmount(e.target.value)} />
                                <button className="btn btn-primary" onClick={registerRelay}>Register</button>
                             </div>
                        )}
                    </div>
                </div>

                {/* Staking Controls (If Registered) */}
                {status.registered && (
                     <div className="staking-controls-area">
                         <h4>Staking Operations</h4>
                         <div className="staking-tabs">
                             <button className={`btn-tab ${stakingMode==='increase'?'active':''}`} onClick={()=>setStakingMode('increase')}>Increase Stake</button>
                             <button className={`btn-tab ${stakingMode==='unstake'?'active':''}`} onClick={()=>setStakingMode('unstake')}>Unstake</button>
                             <button className={`btn-tab ${stakingMode==='withdraw'?'active':''}`} onClick={()=>setStakingMode('withdraw')}>Withdraw</button>
                         </div>
                         <div className="staking-action-row">
                             <input type="number" className="input" value={stakeActionAmount} onChange={e => setStakeActionAmount(e.target.value)} placeholder="Amount USDC" />
                             <button className="btn btn-primary" onClick={handleStakingAction}>
                                 {stakingMode === 'increase' ? '➕ Stake' : stakingMode === 'unstake' ? '⏳ Request Unstake' : '💸 Withdraw'}
                             </button>
                         </div>
                         <p className="helper-text">
                             Current Stake: <strong>{status.relay?.stakedAmount} USDC</strong> • 
                             Pending Unstake: <strong>0 USDC</strong>
                         </p>
                     </div>
                )}
                
                {actionStatus && <div className="action-status-msg">{actionStatus}</div>}
            </div>
        )}

        {/* Deals List */}
        {status?.registered && deals.length > 0 && (
          <div className="card registry-section full-width">
            <h3>On-Chain Deals ({deals.length})</h3>
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
