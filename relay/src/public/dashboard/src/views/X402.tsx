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
  const { isAuthenticated } = useAuth()
  const [config, setConfig] = useState<X402Config | null>(null)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<'checking' | 'active' | 'disabled' | 'error'>('checking')

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

export default X402
