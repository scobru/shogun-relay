import { useEffect } from 'react'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'rapi-doc': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        'spec-url'?: string; 'theme'?: string; 'render-style'?: string
        'show-header'?: string; 'allow-authentication'?: string
        'primary-color'?: string; 'bg-color'?: string; 'text-color'?: string; 'nav-bg-color'?: string
      }, HTMLElement>
    }
  }
}

function ApiDocs() {
  useEffect(() => {
    if (!customElements.get('rapi-doc')) {
      const script = document.createElement('script')
      script.type = 'module'
      script.src = 'https://unpkg.com/rapidoc/dist/rapidoc-min.js'
      document.head.appendChild(script)
    }
  }, [])

  return (
    <div className="h-[calc(100vh-120px)] overflow-hidden">
      <div className="h-full rounded-xl overflow-hidden border border-base-300">
        {/* @ts-ignore */}
        <rapi-doc
          spec-url="/api/openapi.json"
          theme="dark"
          render-style="read"
          show-header="false"
          allow-authentication="true"
          primary-color="#6366f1"
          bg-color="#0f172a"
          text-color="#e2e8f0"
          nav-bg-color="#1e293b"
        ></rapi-doc>
      </div>
    </div>
  )
}

export default ApiDocs
