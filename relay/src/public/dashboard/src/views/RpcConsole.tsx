import { useState, useEffect } from 'react'


const RPC_METHODS = [
  { name: 'eth_blockNumber', desc: 'Get latest block number', params: [] },
  { name: 'eth_getBalance', desc: 'Get balance of address', params: ['address', 'block'] },
  { name: 'eth_getTransactionCount', desc: 'Get nonce', params: ['address', 'block'] },
  { name: 'eth_gasPrice', desc: 'Get current gas price', params: [] },
  { name: 'eth_chainId', desc: 'Get chain ID', params: [] },
  { name: 'net_version', desc: 'Get network ID', params: [] },
  { name: 'eth_getBlockByNumber', desc: 'Get block by number', params: ['blockNumber', 'fullTxs'] },
]

interface Network {
  name: string
  network: string
  rpc: string
  status: string
}

function RpcConsole() {
  const [networks, setNetworks] = useState<Network[]>([])
  const [endpoint, setEndpoint] = useState('')
  const [method, setMethod] = useState('')
  const [params, setParams] = useState('')
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [responseStatus, setResponseStatus] = useState<'success' | 'error' | ''>('')

  useEffect(() => {
    loadNetworks()
  }, [])

  const loadNetworks = async () => {
    try {
      const res = await fetch('/rpc-status')
      const data = await res.json()
      if (data.success && data.rpcs) {
        setNetworks(data.rpcs)
      }
    } catch (error) {
      console.error('Failed to load networks:', error)
    }
  }

  const executeRpc = async () => {
    if (!endpoint || !method) {
      setResponse(JSON.stringify({ error: 'Configure endpoint and method' }, null, 2))
      setResponseStatus('error')
      return
    }

    setLoading(true)
    setResponse('Executing...')

    let paramsArray: any[] = []
    try {
      if (params.trim()) {
        paramsArray = JSON.parse(params)
      }
    } catch (e) {
      setResponse(JSON.stringify({ error: 'Invalid JSON in parameters' }, null, 2))
      setResponseStatus('error')
      setLoading(false)
      return
    }

    const requestBody = { jsonrpc: '2.0', method, params: paramsArray, id: 1 }

    try {
      // Use proxy to avoid CORS
      const res = await fetch('/api/v1/system/rpc/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, request: requestBody })
      })
      const data = await res.json()
      setResponse(JSON.stringify(data.success ? data.response : data, null, 2))
      setResponseStatus(data.success ? 'success' : 'error')
    } catch (error: any) {
      setResponse(JSON.stringify({ error: error.message }, null, 2))
      setResponseStatus('error')
    } finally {
      setLoading(false)
    }
  }

  const generateCurl = () => {
    if (!endpoint || !method) return 'Configure endpoint and method first'
    let paramsArray: any[] = []
    try { if (params.trim()) paramsArray = JSON.parse(params) } catch {}
    const body = { jsonrpc: '2.0', method, params: paramsArray, id: 1 }
    return `curl -X POST ${endpoint} \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(body)}'`
  }

  return (
    <div className="rpc-page">
      <div className="rpc-header card">
        <h2>💻 RPC Console</h2>
        <p>Execute blockchain RPC calls</p>
      </div>

      <div className="rpc-grid">
        {/* Input Panel */}
        <div className="card rpc-panel">
          <h3>Configuration</h3>

          <div className="rpc-form-group">
            <label>Network</label>
            <select
              className="input"
              onChange={e => {
                const idx = parseInt(e.target.value, 10)
                if (!isNaN(idx) && networks[idx]) {
                  setEndpoint(networks[idx].rpc)
                }
              }}
            >
              <option value="">Select network...</option>
              {networks.map((net, i) => (
                <option key={i} value={i}>
                  {net.name} ({net.network}) {net.status === 'online' ? '✓' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="rpc-form-group">
            <label>Endpoint URL</label>
            <input
              type="text"
              className="input"
              placeholder="https://rpc.example.com"
              value={endpoint}
              onChange={e => setEndpoint(e.target.value)}
            />
          </div>

          <div className="rpc-form-group">
            <label>Method</label>
            <select className="input" value={method} onChange={e => setMethod(e.target.value)}>
              <option value="">Select method...</option>
              {RPC_METHODS.map(m => (
                <option key={m.name} value={m.name}>{m.name} - {m.desc}</option>
              ))}
            </select>
          </div>

          <div className="rpc-form-group">
            <label>Parameters (JSON array)</label>
            <textarea
              className="input"
              placeholder='["0x1", "latest"]'
              value={params}
              onChange={e => setParams(e.target.value)}
              rows={3}
            />
          </div>

          <button className="btn btn-primary" onClick={executeRpc} disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Executing...' : '▶️ Execute'}
          </button>
        </div>

        {/* Output Panel */}
        <div className="card rpc-panel">
          <h3>Request</h3>
          <pre className="rpc-code">{generateCurl()}</pre>

          <h3>Response</h3>
          <pre className={`rpc-code rpc-response ${responseStatus}`}>
            {response || 'Execute a request to see response'}
          </pre>
        </div>
      </div>
    </div>
  )
}

export default RpcConsole
