import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import './X402.css'

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
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [config, setConfig] = useState<X402Config | null>(null)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<'checking' | 'active' | 'disabled' | 'error'>('checking')

  useEffect(() => {
    fetchX402Status()
  }, [])

  const fetchX402Status = async () => {
    setLoading(true)
    setStatus('checking')
    
    try {
      // Check if x402 is enabled
      const healthRes = await fetch('/health')
      const healthData = await healthRes.json()
      const isEnabled = healthData.success && healthData.data?.modules?.x402

      if (!isEnabled) {
        setStatus('disabled')
        setLoading(false)
        return
      }

      // Fetch config
      const configRes = await fetch('/api/v1/x402/config')
      const configData = await configRes.json()
      
      if (configData.success) {
        setConfig(configData.config)
        setStatus('active')
      }

      // Fetch tiers
      const tiersRes = await fetch('/api/v1/x402/tiers')
      const tiersData = await tiersRes.json()
      
      if (tiersData.success) {
        setTiers(tiersData.tiers || [])
      }
    } catch (error) {
      console.error('Failed to fetch x402 status:', error)
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }

  const getChainName = (chainId: number) => {
    const chains: Record<number, string> = {
      1: 'Ethereum',
      84532: 'Base Sepolia',
      8453: 'Base',
      11155111: 'Sepolia'
    }
    return chains[chainId] || `Chain ${chainId}`
  }

  return (
    <div className="x402-page">
      {/* Header */}
      <div className="x402-header card">
        <div>
          <h2>💳 x402 Payment Service</h2>
          <p>Decentralized subscription and payment management</p>
        </div>
        <button className="btn btn-primary" onClick={fetchX402Status}>
          🔄 Refresh
        </button>
      </div>

      {/* Status Card */}
      <div className="x402-status card">
        <div className="status-header">
          <h3>Service Status</h3>
          <span className={`status-indicator ${status}`}>
            {status === 'checking' && '⏳ Checking...'}
            {status === 'active' && '✅ Active'}
            {status === 'disabled' && '⚠️ Disabled'}
            {status === 'error' && '❌ Error'}
          </span>
        </div>

        {loading ? (
          <div className="loading">Loading x402 configuration...</div>
        ) : status === 'disabled' ? (
          <div className="disabled-message">
            <p>The x402 payment service is currently disabled.</p>
            <p className="hint">Enable it in your relay configuration to accept payments.</p>
          </div>
        ) : status === 'error' ? (
          <div className="error-message">
            <p>Failed to load x402 configuration.</p>
          </div>
        ) : config && (
          <div className="config-details">
            <div className="config-item">
              <span className="label">Chain:</span>
              <span className="value">{getChainName(config.chainId)}</span>
            </div>
            <div className="config-item">
              <span className="label">Payment Token:</span>
              <span className="value">{config.paymentTokenSymbol}</span>
            </div>
            <div className="config-item">
              <span className="label">Facilitator URL:</span>
              <span className="value mono">{config.facilitatorUrl || 'Not configured'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Tiers */}
      {status === 'active' && tiers.length > 0 && (
        <div className="x402-tiers card">
          <h3>Available Subscription Tiers</h3>
          <div className="tiers-grid">
            {tiers.map((tier: Tier, index: number) => (
              <div key={index} className="tier-card">
                <div className="tier-header">
                  <h4>{tier.name}</h4>
                  <div className="tier-price">
                    <span className="price">{tier.priceUSDC}</span>
                    <span className="currency">USDC</span>
                  </div>
                </div>
                <div className="tier-details">
                  <div className="tier-spec">
                    <span className="icon">💾</span>
                    <span>{tier.storageMB} MB Storage</span>
                  </div>
                  <div className="tier-spec">
                    <span className="icon">📅</span>
                    <span>{tier.durationDays} Days</span>
                  </div>
                </div>
                {tier.features && tier.features.length > 0 && (
                  <div className="tier-features">
                    <div className="features-label">Features:</div>
                    <ul>
                      {tier.features.map((feature: string, i: number) => (
                        <li key={i}>{feature}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="x402-info card">
        <h3>ℹ️ About x402</h3>
        <p>
          x402 is a decentralized payment protocol that enables subscription-based access to relay services.
          Users can purchase storage subscriptions using USDC on supported blockchain networks.
        </p>
        <div className="info-links">
          <a href="/api/v1/x402/tiers" target="_blank" className="btn btn-secondary btn-sm">
            📄 View API
          </a>
          {isAuthenticated && (
            <a href="/api/v1/x402/config" target="_blank" className="btn btn-secondary btn-sm">
              ⚙️ View Config
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export default X402
