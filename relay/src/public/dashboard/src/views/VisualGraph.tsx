import { useState, useEffect, useRef } from 'react'
import Graph from 'react-vis-network-graph'
import { useAuth } from '../context/AuthContext'
import './VisualGraph.css'

interface GraphNode {
  id: string
  label: string
  group?: string
  title?: string
  value?: number
}

interface GraphEdge {
  from: string
  to: string
  label?: string
  arrows?: string
}

function VisualGraph() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[], edges: GraphEdge[] }>({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(false)
  const [path, setPath] = useState('shogun')
  const [peerUrl, setPeerUrl] = useState('')
  const [nodeCount, setNodeCount] = useState(0)

  // Graph options
  const options = {
    layout: {
      hierarchical: false
    },
    edges: {
      color: "#000000",
      smooth: {
        type: "continuous"
      }
    },
    nodes: {
      shape: "dot",
      size: 10,
      font: {
        size: 12,
        color: "#333333"
      },
      borderWidth: 2
    },
    physics: {
      stabilization: false,
      barnesHut: {
        gravitationalConstant: -8000,
        springConstant: 0.04,
        springLength: 95
      }
    },
    interaction: {
        hover: true,
        tooltipDelay: 200
    },
    height: "600px"
  };

  const exploreData = async (nodePath: string) => {
    if (!nodePath) return
    setLoading(true)
    
    try {
      // Use the generic node endpoint
      const response = await fetch(`/api/v1/system/node/${nodePath}`, {
        headers: getAuthHeaders()
      })
      
      const data = await response.json()
      
      if (data.success && data.data) {
        processGraphData(nodePath, data.data)
      }
    } catch (error) {
      console.error('Failed to fetch graph data:', error)
    } finally {
      setLoading(false)
    }
  }

  const processGraphData = (rootPath: string, data: any) => {
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const processedNodes = new Set<string>()

    // Add root node
    nodes.push({
        id: rootPath,
        label: rootPath,
        group: 'root',
        value: 20,
        title: `Path: ${rootPath}`
    })
    processedNodes.add(rootPath)

    // Process children
    if (typeof data === 'object' && data !== null) {
        Object.entries(data).forEach(([key, value]) => {
            // Skip metadata
            if (key === '_') return

            const nodeId = `${rootPath}/${key}`
            const isObject = typeof value === 'object' && value !== null
            
            // Add node
            if (!processedNodes.has(nodeId)) {
                nodes.push({
                    id: nodeId,
                    label: key,
                    group: isObject ? 'object' : 'value',
                    value: isObject ? 15 : 10,
                    title: `Value: ${isObject ? JSON.stringify(value).substring(0, 50) + '...' : String(value)}`
                })
                processedNodes.add(nodeId)
            }

            // Add edge
            edges.push({
                from: rootPath,
                to: nodeId,
                arrows: 'to'
            })
        })
    }

    setGraphData({ nodes, edges })
    setNodeCount(nodes.length)
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    exploreData(path)
  }

  const handleAddPeer = async (e: React.FormEvent) => {
      e.preventDefault()
      if (!peerUrl) return

      try {
          const response = await fetch('/api/v1/system/peers/add', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  ...getAuthHeaders()
              },
              body: JSON.stringify({ peer: peerUrl })
          })
          
          if (response.ok) {
              alert('Peer added successfully')
              setPeerUrl('')
          }
      } catch (error) {
          console.error('Failed to add peer:', error)
      }
  }

  useEffect(() => {
    // Initial exploration
    exploreData('shogun')
  }, [])

  return (
    <div className="visual-graph-page">
      <div className="graph-header card">
        <div className="header-content">
            <div>
                <h2>🕸️ Visual Graph Explorer</h2>
                <p>Visualize and explore GunDB nodes interactively</p>
            </div>
            
            <div className="graph-controls">
                <form onSubmit={handleSearch} className="search-form">
                    <input 
                        type="text" 
                        value={path} 
                        onChange={(e) => setPath(e.target.value)}
                        placeholder="Enter GunDB path (e.g. shogun/relays)"
                        className="search-input"
                    />
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Loading...' : '🔍 Explore'}
                    </button>
                </form>

                <form onSubmit={handleAddPeer} className="peer-form">
                    <input 
                        type="text" 
                        value={peerUrl} 
                        onChange={(e) => setPeerUrl(e.target.value)}
                        placeholder="Add Peer URL"
                        className="peer-input"
                    />
                    <button type="submit" className="btn btn-secondary">
                        ➕ Add Peer
                    </button>
                </form>
            </div>
        </div>
        
        <div className="graph-stats">
            <span className="badge">Nodes: {nodeCount}</span>
            <span className="badge">Path: {path}</span>
        </div>
      </div>

      <div className="graph-container card">
        <Graph
          graph={graphData}
          options={options}
          events={{
            select: (event: any) => {
              const { nodes } = event;
              if (nodes.length > 0) {
                  const nodeId = nodes[0];
                  // If clicking a child node that is effectively a path, explore it
                  if (nodeId.includes('/') && nodeId !== path) {
                      setPath(nodeId)
                      exploreData(nodeId)
                  }
              }
            }
          }}
        />
      </div>
    </div>
  )
}

export default VisualGraph
