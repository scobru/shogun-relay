import { useEffect, useState } from 'react'
import './ApiDocs.css'

interface Endpoint {
  method: string
  path: string
  description: string
  auth?: string
  category: string
}

const API_ENDPOINTS: Endpoint[] = [
  // Health
  { method: 'GET', path: '/health', description: 'Get server health status', category: 'Health' },
  { method: 'GET', path: '/rpc-status', description: 'Get RPC endpoints status', category: 'Health' },
  
  // IPFS
  { method: 'POST', path: '/api/v1/ipfs/upload', description: 'Upload file to IPFS', auth: 'Bearer', category: 'IPFS' },
  { method: 'POST', path: '/api/v1/ipfs/upload-directory', description: 'Upload directory to IPFS', auth: 'Bearer', category: 'IPFS' },
  { method: 'GET', path: '/api/v1/ipfs/cat/:cid', description: 'Get file content by CID', category: 'IPFS' },
  { method: 'GET', path: '/api/v1/ipfs/pin/ls', description: 'List all pins', auth: 'Bearer', category: 'IPFS' },
  { method: 'POST', path: '/api/v1/ipfs/pin/add', description: 'Pin a CID', auth: 'Bearer', category: 'IPFS' },
  { method: 'POST', path: '/api/v1/ipfs/pin/rm', description: 'Unpin a CID', auth: 'Bearer', category: 'IPFS' },
  { method: 'GET', path: '/api/v1/ipfs/stats', description: 'Get IPFS node stats', category: 'IPFS' },
  
  // Network
  { method: 'GET', path: '/api/v1/network/stats', description: 'Get network statistics', category: 'Network' },
  { method: 'GET', path: '/api/v1/network/reputation', description: 'Get reputation leaderboard', category: 'Network' },
  
  // Registry
  { method: 'GET', path: '/api/v1/registry/config', description: 'Get registry configuration', category: 'Registry' },
  { method: 'GET', path: '/api/v1/registry/status', description: 'Get relay registration status', category: 'Registry' },
  { method: 'GET', path: '/api/v1/registry/balance', description: 'Get wallet balances', category: 'Registry' },
  { method: 'POST', path: '/api/v1/registry/register', description: 'Register relay on-chain', auth: 'Bearer', category: 'Registry' },
  
  // Torrents
  { method: 'GET', path: '/api/v1/torrent/status', description: 'Get torrent client status', category: 'Torrents' },
  { method: 'POST', path: '/api/v1/torrent/add', description: 'Add torrent via magnet link', auth: 'Bearer', category: 'Torrents' },
  { method: 'GET', path: '/api/v1/torrent/list', description: 'List active torrents', category: 'Torrents' },
  
  // API Keys
  { method: 'GET', path: '/api/v1/api-keys', description: 'List API keys', auth: 'Bearer', category: 'API Keys' },
  { method: 'POST', path: '/api/v1/api-keys', description: 'Create new API key', auth: 'Bearer', category: 'API Keys' },
  { method: 'DELETE', path: '/api/v1/api-keys/:keyId', description: 'Revoke API key', auth: 'Bearer', category: 'API Keys' },
  
  // Drive
  { method: 'GET', path: '/api/v1/drive/list', description: 'List files in drive', auth: 'Bearer', category: 'Drive' },
  { method: 'POST', path: '/api/v1/drive/upload', description: 'Upload file to drive', auth: 'Bearer', category: 'Drive' },
  { method: 'POST', path: '/api/v1/drive/folder', description: 'Create folder', auth: 'Bearer', category: 'Drive' },
  { method: 'DELETE', path: '/api/v1/drive/delete', description: 'Delete file/folder', auth: 'Bearer', category: 'Drive' },
]

function ApiDocs() {
  const [filter, setFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const categories = [...new Set(API_ENDPOINTS.map(e => e.category))]

  const filteredEndpoints = API_ENDPOINTS.filter(e => {
    const matchesText = !filter || 
      e.path.toLowerCase().includes(filter.toLowerCase()) ||
      e.description.toLowerCase().includes(filter.toLowerCase())
    const matchesCategory = !categoryFilter || e.category === categoryFilter
    return matchesText && matchesCategory
  })

  const groupedEndpoints = filteredEndpoints.reduce((acc, endpoint) => {
    if (!acc[endpoint.category]) acc[endpoint.category] = []
    acc[endpoint.category].push(endpoint)
    return acc
  }, {} as Record<string, Endpoint[]>)

  const getMethodClass = (method: string) => {
    switch (method) {
      case 'GET': return 'method-get'
      case 'POST': return 'method-post'
      case 'DELETE': return 'method-delete'
      case 'PUT': return 'method-put'
      default: return ''
    }
  }

  return (
    <div className="apidocs-page">
      <div className="apidocs-header card">
        <div>
          <h2>📄 API Documentation</h2>
          <p>Available endpoints for the Shogun Relay API</p>
        </div>
      </div>

      {/* Filters */}
      <div className="apidocs-filters card">
        <input
          type="text"
          className="input"
          placeholder="Search endpoints..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <select className="input" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* Endpoints by category */}
      {Object.entries(groupedEndpoints).map(([category, endpoints]) => (
        <div key={category} className="apidocs-category">
          <h3>{category}</h3>
          <div className="apidocs-list">
            {endpoints.map((endpoint, i) => (
              <div key={i} className="apidocs-endpoint card">
                <div className="apidocs-endpoint-header">
                  <span className={`apidocs-method ${getMethodClass(endpoint.method)}`}>
                    {endpoint.method}
                  </span>
                  <code className="apidocs-path">{endpoint.path}</code>
                  {endpoint.auth && <span className="apidocs-auth">🔒 {endpoint.auth}</span>}
                </div>
                <p className="apidocs-desc">{endpoint.description}</p>
              </div>
            ))}
          </div>
        </div>
      ))}

      {filteredEndpoints.length === 0 && (
        <div className="apidocs-empty card">
          <p>No endpoints match your search.</p>
        </div>
      )}
    </div>
  )
}

export default ApiDocs
