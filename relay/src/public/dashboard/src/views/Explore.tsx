import { useNavigate } from 'react-router-dom'
import './Explore.css'

function Explore() {
  const navigate = useNavigate()

  const sections = [
    {
      title: 'Graph Explorer',
      description: 'Inspect GunDB nodes, traverse the graph data, and modify properties directly.',
      path: '/dashboard/graph-explorer',
      icon: '🔍',
      color: 'var(--color-primary)'
    },
    {
      title: 'Visual Graph',
      description: 'Interactive visualization of the GunDB node network and connections.',
      path: '/dashboard/visual-graph',
      icon: '🕸️',
      color: 'var(--color-secondary)'
    },
    {
      title: 'Network Stats',
      description: 'Live view of connected peers, relay performance, and system resources.',
      path: '/dashboard/stats',
      icon: '📊',
      color: 'var(--color-success)'
    },
    {
      title: 'IPFS Files',
      description: 'Manage pinned files, search content, and monitor storage usage.',
      path: '/dashboard/files',
      icon: '📁',
      color: 'var(--color-warning)'
    }
  ]

  return (
    <div className="explore-page">
      <div className="explore-header card">
        <h2>🧭 Data Hub</h2>
        <p>Central navigation for all Shogun Relay subsystems and data inspectors.</p>
      </div>

      <div className="explore-grid">
        {sections.map(section => (
          <div 
            key={section.path} 
            className="explore-card card" 
            onClick={() => navigate(section.path)}
          >
            <div className="explore-card-icon" style={{ backgroundColor: section.color + '20', color: section.color }}>
              {section.icon}
            </div>
            <div className="explore-card-content">
              <h3>{section.title}</h3>
              <p>{section.description}</p>
            </div>
            <div className="explore-card-arrow">➡</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Explore
