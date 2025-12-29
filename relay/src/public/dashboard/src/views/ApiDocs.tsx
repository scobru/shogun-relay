import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import './ApiDocs.css'

// Add RapiDoc element type definition
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'rapi-doc': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        'spec-url'?: string
        'theme'?: string
        'render-style'?: string
        'show-header'?: string
        'allow-authentication'?: string
        'primary-color'?: string
        'bg-color'?: string
        'text-color'?: string
        'nav-bg-color'?: string
      }, HTMLElement>
    }
  }
}

function ApiDocs() {
  const rapiDocRef = useRef<HTMLElement>(null)

  useEffect(() => {
    // Dynamic import of rapidoc if needed, or assume it's loaded in index.html (it is)
    // Legacy index.html loaded it from unpkg: <script type="module" src="https://unpkg.com/rapidoc/dist/rapidoc-min.js"></script>
    // We should ensure it's loaded. For now, assume it's available via script tag in main index.html
    // If not, we might need to add it or npm install it.
    // Given the constraints, I will add a script tag helper if missing.
    
    if (!customElements.get('rapi-doc')) {
        const script = document.createElement('script')
        script.type = 'module'
        script.src = 'https://unpkg.com/rapidoc/dist/rapidoc-min.js'
        document.head.appendChild(script)
    }
  }, [])

  return (
    <div className="apidocs-page" style={{ height: 'calc(100vh - 100px)', overflow: 'hidden' }}>
      <div className="apidocs-container" style={{ height: '100%', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
        {/* @ts-ignore */}
        <rapi-doc
          spec-url="/api/openapi.json"
          theme="dark"
          render-style="read"
          show-header="false"
          allow-authentication="true"
          primary-color="#FF69B4"
          bg-color="#1A1A1A"
          text-color="#E0E0E0"
          nav-bg-color="#282828"
        ></rapi-doc>
      </div>
    </div>
  )
}

export default ApiDocs
