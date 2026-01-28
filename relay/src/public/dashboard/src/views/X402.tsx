import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

interface X402Config {
  enabled: boolean
  chainId: number
  paymentTokenSymbol: string
  facilitatorUrl: string
}

interface Tier {
  name: string
  storageMB: number
  durationDays: number
  priceUSDC: number
  features: string[]
}

function X402() {
  const { isAuthenticated, password } = useAuth()
  const [config, setConfig] = useState<X402Config | null>(null)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<'checking' | 'active' | 'disabled' | 'error'>('checking')
  const [subscriptions, setSubscriptions] = useState<any[]>([])
  const [loadingSubs, setLoadingSubs] = useState(false)

  useEffect(() => { fetchX402Status() }, [])

  const fetchX402Status = async () => {
    setLoading(true)
    setStatus('checking')
    try {
      // Directly check x402 config endpoint instead of health modules
      const configRes = await fetch('/api/v1/x402/config')
      const configData = await configRes.json()
      
      if (configData.success && configData.config) {
        setConfig(configData.config)
        setStatus('active')
        
        // Also fetch tiers
        const tiersRes = await fetch('/api/v1/x402/tiers')
        const tiersData = await tiersRes.json()
        if (tiersData.success) setTiers(tiersData.tiers || [])
      } else {
        setStatus('disabled')
      }
    } catch (error) {
      console.error('Failed to fetch x402 status:', error)
      setStatus('disabled') // If endpoint fails, x402 is likely disabled
    } finally { setLoading(false) }
  }

  const getChainName = (chainId: number) => {
    const chains: Record<number, string> = { 1: 'Ethereum', 84532: 'Base Sepolia', 8453: 'Base', 11155111: 'Sepolia' }
    return chains[chainId] || `Chain ${chainId}`
  }

  useEffect(() => {
    if (isAuthenticated && status === 'active') {
        fetchSubscriptions()
    }
  }, [isAuthenticated, status])

  const fetchSubscriptions = async () => {
    // Don't fetch if not authenticated
    if (!isAuthenticated || !password) {
      console.log('Skipping subscription fetch - not authenticated')
      return
    }
    
    setLoadingSubs(true)
    try {
        // Use password from auth context (NOT localStorage.getItem('admin_token'))
        const res = await fetch('/api/v1/x402/subscriptions', {
            headers: { 'Authorization': `Bearer ${password}` }
        })
        const data = await res.json()
        if (data.success) {
            setSubscriptions(data.subscriptions)
        } else {
            console.error('Failed to fetch subscriptions:', data.error)
        }
    } catch (e) {
        console.error("Failed to fetch subs", e)
    } finally {
        setLoadingSubs(false)
    }
  }

  const formatDate = (d: any) => new Date(d).toLocaleDateString() + ' ' + new Date(d).toLocaleTimeString()

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Header */}
      <div className="card bg-base-100 shadow">
        <div className="card-body flex-row items-center justify-between">
          <div>
            <h2 className="card-title">💳 x402 Payment Service</h2>
            <p className="text-base-content/60">Decentralized subscription and payment management</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={fetchX402Status}>🔄 Refresh</button>
        </div>
      </div>

      {/* Status Card */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex items-center justify-between mb-4">
            <h3 className="card-title">Service Status</h3>
            <div className={`badge gap-2 ${status === 'active' ? 'badge-success' : status === 'disabled' ? 'badge-warning' : status === 'error' ? 'badge-error' : 'badge-ghost'}`}>
              {status === 'checking' && <span className="loading loading-spinner loading-xs"></span>}
              {status === 'active' && '✅'} {status === 'disabled' && '⚠️'} {status === 'error' && '❌'}
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center p-8"><span className="loading loading-spinner loading-lg"></span></div>
          ) : status === 'disabled' ? (
            <div className="alert alert-warning">
              <span>The x402 payment service is currently disabled. Enable it in your relay configuration.</span>
            </div>
          ) : status === 'error' ? (
            <div className="alert alert-error"><span>Failed to load x402 configuration.</span></div>
          ) : config && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-base-200 p-4 rounded-lg">
                <div className="text-sm text-base-content/60">Chain</div>
                <div className="font-bold">{getChainName(config.chainId)}</div>
              </div>
              <div className="bg-base-200 p-4 rounded-lg">
                <div className="text-sm text-base-content/60">Payment Token</div>
                <div className="font-bold">{config.paymentTokenSymbol}</div>
              </div>
              <div className="bg-base-200 p-4 rounded-lg">
                <div className="text-sm text-base-content/60">Facilitator</div>
                <div className="font-mono text-xs truncate">{config.facilitatorUrl || 'Not configured'}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tiers */}
      {status === 'active' && tiers.length > 0 && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title mb-4">Available Subscription Tiers</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {tiers.map((tier, index) => (
                <div key={index} className="card bg-base-200">
                  <div className="card-body">
                    <h4 className="card-title text-lg">{tier.name}</h4>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-primary">{tier.priceUSDC}</span>
                      <span className="text-base-content/60">USDC</span>
                    </div>
                    <div className="divider my-2"></div>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-center gap-2">💾 {tier.storageMB} MB Storage</li>
                      <li className="flex items-center gap-2">📅 {tier.durationDays} Days</li>
                      {tier.features?.map((feature, i) => (
                        <li key={i} className="flex items-center gap-2">✓ {feature}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Active Subscriptions - Admin Only */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
            <h3 className="card-title">👥 Active Subscriptions</h3>
            {!isAuthenticated ? (
              <div className="alert alert-info">
                <span>🔒 Login as admin to view active subscriptions</span>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Tier</th>
                                <th>Status</th>
                                <th>Storage</th>
                                <th>Expires</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loadingSubs ? (
                                 <tr><td colSpan={5} className="text-center"><span className="loading loading-spinner"></span></td></tr>
                            ) : subscriptions.length === 0 ? (
                                <tr><td colSpan={5} className="text-center text-base-content/50">No active subscriptions found</td></tr>
                            ) : (
                                subscriptions.map((sub, i) => (
                                    <tr key={i}>
                                        <td className="font-mono text-xs">{sub.userAddress?.substring(0,6)}...{sub.userAddress?.substring(38)}</td>
                                        <td><div className="badge badge-primary badge-outline">{sub.tier}</div></td>
                                        <td>
                                            {sub.isActive ? <span className="text-success">Active</span> : <span className="text-error">Expired</span>}
                                        </td>
                                        <td>{sub.storageUsedMB?.toFixed(2) || 0} / {sub.storageMB} MB</td>
                                        <td className="text-xs">{formatDate(sub.expiresAt)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="divider"></div>
                <button className="btn btn-sm btn-ghost" onClick={fetchSubscriptions}>🔄 Refresh List</button>
              </>
            )}
        </div>
      </div>

       {/* Payment Generator - Admin Only */}
       {isAuthenticated && status === 'active' && (
        <PaymentGenerator password={password} />
      )}

       {/* Custom Payments History - Admin Only */}
       {isAuthenticated && status === 'active' && (
        <PaymentHistory password={password} />
      )}


      
      {/* Info */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h3 className="card-title">ℹ️ About x402</h3>
          <p className="text-base-content/70 mb-4">
            x402 is a decentralized payment protocol that enables subscription-based access to relay services.
            Users can purchase storage subscriptions using USDC on supported blockchain networks.
          </p>
          <div className="flex gap-2 flex-wrap">
            <a href="/api/v1/x402/tiers" target="_blank" className="btn btn-outline btn-sm">📄 View API</a>
            {isAuthenticated && <a href="/api/v1/x402/config" target="_blank" className="btn btn-outline btn-sm">⚙️ View Config</a>}
          </div>
        </div>
      </div>
    </div>
  )
}

// Sub-component for Payment History to keep main component clean
function PaymentHistory({ password }: { password?: string }) {
    const [payments, setPayments] = useState<any[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        fetchHistory()
    }, [])

    const fetchHistory = async () => {
        if (!password) return
        setLoading(true)
        try {
            const res = await fetch('/api/v1/x402/history', {
                headers: { 'Authorization': `Bearer ${password}` }
            })
            const data = await res.json()
            if (data.success) {
                setPayments(data.payments)
            }
        } catch (e) {
            console.error("Failed to fetch history", e)
        } finally {
            setLoading(false)
        }
    }

    const formatDate = (d: any) => new Date(d).toLocaleDateString() + ' ' + new Date(d).toLocaleTimeString()

    return (
        <div className="card bg-base-100 shadow">
        <div className="card-body">
            <div className="flex justify-between items-center">
                <h3 className="card-title">💰 Custom Service Payments</h3>
                <button className="btn btn-sm btn-ghost" onClick={fetchHistory}>🔄 Refresh</button>
            </div>
            
            <div className="overflow-x-auto">
                <table className="table">
                    <thead>
                        <tr>
                            <th>Payer</th>
                            <th>Resource</th>
                            <th>Amount</th>
                            <th>Transaction</th>
                            <th>Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                                <tr><td colSpan={5} className="text-center"><span className="loading loading-spinner"></span></td></tr>
                        ) : payments.length === 0 ? (
                            <tr><td colSpan={5} className="text-center text-base-content/50">No payments found</td></tr>
                        ) : (
                            payments.map((p, i) => (
                                <tr key={i}>
                                    <td className="font-mono text-xs">{p.payer?.substring(0,6)}...{p.payer?.substring(38)}</td>
                                    <td>
                                        <div className="flex flex-col">
                                            <span className="font-bold text-xs">{p.resourceId}</span>
                                            <span className="text-[10px] opacity-70">{p.description}</span>
                                        </div>
                                    </td>
                                    <td className="font-bold text-success">{p.amount} USDC</td>
                                    <td>
                                        <a href={`${p.network === 'base' ? 'https://basescan.org' : 'https://sepolia.basescan.org'}/tx/${p.transaction}`} 
                                           target="_blank" 
                                           className="link link-primary text-xs font-mono">
                                            {p.transaction?.substring(0,8)}...
                                        </a>
                                    </td>
                                    <td className="text-xs">{formatDate(p.timestamp)}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
      </div>
    )
}

// Sub-component for Payment Generator
function PaymentGenerator({ password }: { password?: string }) {
    const [formData, setFormData] = useState({ price: 1, resourceId: '', description: '' })
    const [result, setResult] = useState<any>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleGenerate = async () => {
        if (!password) return
        if (!formData.resourceId || !formData.description) {
            setError("All fields are required")
            return
        }

        setLoading(true)
        setError(null)
        setResult(null)

        try {
            const res = await fetch('/api/v1/x402/requirements/custom', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${password}`
                },
                body: JSON.stringify({
                    priceUSDC: formData.price,
                    resourceId: formData.resourceId,
                    description: formData.description
                })
            })
            const data = await res.json()
            if (data.success) {
                setResult(data.requirements)
            } else {
                setError(data.error || "Failed to generate")
            }
        } catch (e: any) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    const copyToClipboard = () => {
        navigator.clipboard.writeText(JSON.stringify(result, null, 2))
    }

    return (
        <div className="card bg-base-100 shadow">
            <div className="card-body">
                <h3 className="card-title">🛠️ Payment Request Generator</h3>
                <p className="text-sm text-base-content/60 mb-4">Generate x402 payment JSON for testing or manual distribution.</p>
                
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="form-control w-full max-w-xs">
                        <label className="label"><span className="label-text">Price (USDC)</span></label>
                        <input type="number" step="0.01" min="0" className="input input-bordered" 
                            value={formData.price} 
                            onChange={e => setFormData({...formData, price: parseFloat(e.target.value)})} />
                    </div>
                    <div className="form-control w-full">
                        <label className="label"><span className="label-text">Resource ID</span></label>
                        <input type="text" className="input input-bordered" placeholder="e.g. my-premium-api-v1"
                            value={formData.resourceId} 
                            onChange={e => setFormData({...formData, resourceId: e.target.value})} />
                    </div>
                </div>
                <div className="form-control w-full mt-2">
                    <label className="label"><span className="label-text">Description</span></label>
                    <input type="text" className="input input-bordered" placeholder="e.g. Access to specialized dataset"
                        value={formData.description} 
                        onChange={e => setFormData({...formData, description: e.target.value})} />
                </div>

                <div className="card-actions justify-end mt-4">
                    <button className="btn btn-primary" onClick={handleGenerate} disabled={loading}>
                        {loading && <span className="loading loading-spinner"></span>}
                        Generate JSON
                    </button>
                </div>

                {error && <div className="alert alert-error mt-4 text-sm">{error}</div>}

                {result && (
                    <div className="mt-4">
                        <div className="flex justify-between items-center mb-2">
                             <span className="font-bold text-sm">Generated Payment Requirements:</span>
                             <button className="btn btn-xs btn-outline" onClick={copyToClipboard}>📋 Copy JSON</button>
                        </div>
                        <pre className="bg-base-300 p-4 rounded-lg overflow-x-auto text-xs font-mono">
                            {JSON.stringify(result, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    )
}

export default X402
