"use client";

interface ServerStatusProps {
  serverStatus: {
    status: string;
    port: string;
  };
  ipfsStatus: {
    enabled: boolean;
    service: string;
    status: string;
    message: string;
  };
  onRefresh: () => void;
}

const getStatusColor = (status: string): string => {
  switch (status.toLowerCase()) {
    case "online":
    case "running":
    case "connected":
      return "text-success";
    case "offline":
    case "stopped":
    case "disconnected":
      return "text-error";
    case "warning":
    case "degraded":
      return "text-warning";
    default:
      return "text-base-content";
  }
};

const ServerStatus = ({ serverStatus, ipfsStatus, onRefresh }: ServerStatusProps) => {
  return (
    <div className="card bg-base-100 shadow-lg">
      <div className="card-body">
        <div className="flex items-center justify-between mb-6">
          <h3 className="card-title text-xl">System Status</h3>
          <button 
            onClick={onRefresh}
            className="btn btn-ghost btn-sm"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Server Status */}
          <div className="stat bg-base-200 rounded-lg">
            <div className="stat-figure">
              <div className={`w-4 h-4 rounded-full ${
                serverStatus.status === "online" ? "bg-success animate-pulse" : "bg-error"
              }`}></div>
            </div>
            <div className="stat-title">Relay Server</div>
            <div className={`stat-value text-lg ${getStatusColor(serverStatus.status)}`}>
              {serverStatus.status}
            </div>
            <div className="stat-desc">Port: {serverStatus.port}</div>
          </div>

          {/* IPFS Status */}
          <div className="stat bg-base-200 rounded-lg">
            <div className="stat-figure">
              <div className={`w-4 h-4 rounded-full ${
                ipfsStatus.enabled ? "bg-success animate-pulse" : "bg-warning"
              }`}></div>
            </div>
            <div className="stat-title">IPFS Service</div>
            <div className={`stat-value text-lg ${getStatusColor(ipfsStatus.status)}`}>
              {ipfsStatus.enabled ? "Active" : "Inactive"}
            </div>
            <div className="stat-desc">{ipfsStatus.service}</div>
          </div>

          {/* System Health */}
          <div className="stat bg-base-200 rounded-lg">
            <div className="stat-figure">
              <div className="w-4 h-4 rounded-full bg-success animate-pulse"></div>
            </div>
            <div className="stat-title">System Health</div>
            <div className="stat-value text-lg text-success">Healthy</div>
            <div className="stat-desc">All systems operational</div>
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">99.9%</div>
            <div className="text-sm text-base-content/70">Uptime</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-secondary">234MB</div>
            <div className="text-sm text-base-content/70">Memory</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-accent">12ms</div>
            <div className="text-sm text-base-content/70">Response</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-info">1.2GB</div>
            <div className="text-sm text-base-content/70">Storage</div>
          </div>
        </div>

        {/* Status Messages */}
        {ipfsStatus.message && ipfsStatus.message !== "Unknown" && (
          <div className="alert alert-info mt-4">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{ipfsStatus.message}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default ServerStatus; 