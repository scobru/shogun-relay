/**
 * Shogun Relay - Shared Components
 * Web Components riutilizzabili per la dashboard
 */

// ============================================================================
// SHOGUN HEADER COMPONENT
// ============================================================================

class ShogunHeader extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes() {
    return ['title', 'subtitle', 'icon', 'show-back'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const title = this.getAttribute('title') || 'Shogun Relay';
    const subtitle = this.getAttribute('subtitle') || '';
    const showBack = this.hasAttribute('show-back');
    const icon = this.getAttribute('icon') || 'bolt';

    const iconSvg = this.getIconSvg(icon);
    const backUrl = localStorage.getItem('shogun-relay-admin-password') ? '/admin' : '/';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        .header {
          background: radial-gradient(ellipse at top, rgba(255, 105, 180, 0.18) 0%, transparent 60%),
                      linear-gradient(135deg, #1A1A1A 0%, #0D0D0D 100%);
          color: white;
          padding: 32px 24px;
          text-align: center;
          border-bottom: 1px solid #404040;
        }
        .header-content {
          max-width: 1280px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .header-icon {
          width: 64px;
          height: 64px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 16px;
          background-color: rgba(255, 255, 255, 0.15);
          margin-bottom: 16px;
        }
        .header-icon svg {
          width: 32px;
          height: 32px;
          color: white;
        }
        h1 {
          font-family: 'Google Sans', 'Roboto', sans-serif;
          font-size: 1.75rem;
          font-weight: 500;
          margin: 0 0 8px 0;
        }
        .subtitle {
          opacity: 0.8;
          font-size: 0.95rem;
          margin: 0;
        }
        .back-link {
          position: absolute;
          left: 24px;
          top: 24px;
          display: flex;
          align-items: center;
          gap: 8px;
          color: #42A5F5;
          text-decoration: none;
          font-size: 14px;
          transition: color 0.2s;
        }
        .back-link:hover {
          color: #64B5F6;
        }
        .back-link svg {
          width: 18px;
          height: 18px;
        }
        .nav-row {
          display: flex;
          justify-content: center;
          gap: 12px;
          margin-top: 20px;
          flex-wrap: wrap;
        }
        .nav-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 100px;
          text-decoration: none;
          font-size: 13px;
          font-weight: 500;
          color: #e0e0e0;
          background-color: rgba(255,255,255,0.08);
          border: 1px solid #404040;
          transition: all 0.2s;
        }
        .nav-pill:hover {
          background-color: rgba(255,105,180,0.15);
          border-color: #ff69b4;
          color: white;
        }
        .nav-pill svg {
          width: 16px;
          height: 16px;
        }
        @media (max-width: 640px) {
          .header {
            padding: 24px 16px;
          }
          h1 {
            font-size: 1.4rem;
          }
          .back-link {
            position: static;
            margin-bottom: 16px;
          }
        }
      </style>
      <header class="header">
        <div class="header-content">
          ${showBack ? `
            <a href="${backUrl}" class="back-link">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
              </svg>
              Back
            </a>
          ` : ''}
          <div class="header-icon">${iconSvg}</div>
          <h1>${title}</h1>
          ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}
          <nav class="nav-row">
            <a href="/" class="nav-pill">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
              </svg>
              Home
            </a>
            <a href="/admin" class="nav-pill">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
              </svg>
              Admin
            </a>
            <a href="/endpoints" class="nav-pill">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              API Docs
            </a>
          </nav>
        </div>
      </header>
    `;
  }

  getIconSvg(icon) {
    const icons = {
      bolt: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>',
      lock: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>',
      chart: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>',
      globe: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9"/></svg>',
      upload: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>',
      folder: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>',
      key: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>',
      terminal: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>',
      cube: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5"/></svg>',
      server: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"/></svg>',
      pin: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>'
    };
    return icons[icon] || icons.bolt;
  }
}

// ============================================================================
// SHOGUN CARD COMPONENT
// ============================================================================

class ShogunCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        .card {
          background-color: #1a1a1a;
          border: 1px solid #404040;
          border-radius: 16px;
          padding: 24px;
          transition: all 0.2s;
        }
        .card:hover {
          border-color: #505050;
        }
        ::slotted(*) {
          color: white;
        }
      </style>
      <div class="card">
        <slot></slot>
      </div>
    `;
  }
}

// ============================================================================
// SHOGUN STAT COMPONENT
// ============================================================================

class ShogunStat extends HTMLElement {
  static get observedAttributes() {
    return ['label', 'value', 'icon', 'color'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const label = this.getAttribute('label') || 'Stat';
    const value = this.getAttribute('value') || '0';
    const color = this.getAttribute('color') || '#42A5F5';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        .stat {
          background-color: #282828;
          border-radius: 12px;
          padding: 16px 20px;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .stat-icon {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: ${color}22;
          color: ${color};
        }
        .stat-icon svg {
          width: 24px;
          height: 24px;
        }
        .stat-content {
          flex: 1;
        }
        .stat-value {
          font-family: 'Google Sans', sans-serif;
          font-size: 1.5rem;
          font-weight: 500;
          color: white;
          margin-bottom: 2px;
        }
        .stat-label {
          font-size: 0.875rem;
          color: #e0e0e0;
        }
      </style>
      <div class="stat">
        <div class="stat-icon">
          <slot name="icon"></slot>
        </div>
        <div class="stat-content">
          <div class="stat-value">${value}</div>
          <div class="stat-label">${label}</div>
        </div>
      </div>
    `;
  }
}

// ============================================================================
// SHOGUN LOADING COMPONENT
// ============================================================================

class ShogunLoading extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 48px;
        }
        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid #404040;
          border-top-color: #ff69b4;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
      <div class="spinner"></div>
    `;
  }
}

// ============================================================================
// REGISTER COMPONENTS
// ============================================================================

customElements.define('shogun-header', ShogunHeader);
customElements.define('shogun-card', ShogunCard);
customElements.define('shogun-stat', ShogunStat);
customElements.define('shogun-loading', ShogunLoading);

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

window.ShogunUtils = {
  // Format bytes to human readable
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  },

  // Format timestamp to relative time
  formatRelativeTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  },

  // Truncate hash
  truncateHash(hash, length = 8) {
    if (!hash || hash.length <= length * 2) return hash;
    return `${hash.slice(0, length)}...${hash.slice(-length)}`;
  },

  // Copy to clipboard
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('Failed to copy:', err);
      return false;
    }
  },

  // Show toast notification
  showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'shogun-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      padding: 12px 24px;
      background-color: ${type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : '#323232'};
      color: white;
      border-radius: 8px;
      font-size: 14px;
      z-index: 9999;
      animation: slideUp 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  },

  // Fetch with auth
  async fetchWithAuth(url, options = {}) {
    const password = localStorage.getItem('shogun-relay-admin-password');
    const headers = {
      ...options.headers,
      ...(password ? { 'Authorization': `Bearer ${password}` } : {})
    };
    return fetch(url, { ...options, headers });
  }
};

console.log('✅ Shogun Components loaded');
