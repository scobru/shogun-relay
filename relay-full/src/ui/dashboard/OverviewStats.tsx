"use client";

interface FileStats {
  count: number;
  totalSize: number;
}

interface ServerStatus {
  status: string;
  port: string;
}

interface IpfsStatus {
  enabled: boolean;
  service: string;
  status: string;
  message: string;
}

interface OverviewStatsProps {
  fileStats: FileStats;
  serverStatus: ServerStatus;
  ipfsStatus: IpfsStatus;
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

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

const getStatusBadge = (status: string): string => {
  switch (status.toLowerCase()) {
    case "online":
    case "running":
    case "connected":
      return "badge-success";
    case "offline":
    case "stopped":
    case "disconnected":
      return "badge-error";
    case "warning":
    case "degraded":
      return "badge-warning";
    default:
      return "badge-ghost";
  }
};

const OverviewStats = ({ fileStats, serverStatus, ipfsStatus }: OverviewStatsProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {/* Files Count */}
      <div className="stat bg-base-100 shadow-lg rounded-lg">
        <div className="stat-figure text-primary">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="stat-title">Total Files</div>
        <div className="stat-value text-primary">{fileStats.count}</div>
        <div className="stat-desc">Files stored in system</div>
      </div>

      {/* Storage Used */}
      <div className="stat bg-base-100 shadow-lg rounded-lg">
        <div className="stat-figure text-secondary">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
          </svg>
        </div>
        <div className="stat-title">Storage Used</div>
        <div className="stat-value text-secondary">{formatFileSize(fileStats.totalSize)}</div>
        <div className="stat-desc">Total storage consumed</div>
      </div>

      {/* Server Status */}
      <div className="stat bg-base-100 shadow-lg rounded-lg">
        <div className={`stat-figure ${getStatusColor(serverStatus.status)}`}>
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
          </svg>
        </div>
        <div className="stat-title">Server Status</div>
        <div className="stat-value">
          <span className={`badge ${getStatusBadge(serverStatus.status)} gap-2`}>
            <div className="w-2 h-2 rounded-full bg-current animate-pulse"></div>
            {serverStatus.status}
          </span>
        </div>
        <div className="stat-desc">Port: {serverStatus.port}</div>
      </div>

      {/* IPFS Status */}
      <div className="stat bg-base-100 shadow-lg rounded-lg">
        <div className={`stat-figure ${getStatusColor(ipfsStatus.status)}`}>
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        </div>
        <div className="stat-title">IPFS Status</div>
        <div className="stat-value">
          <span className={`badge ${getStatusBadge(ipfsStatus.status)} gap-2`}>
            <div className="w-2 h-2 rounded-full bg-current animate-pulse"></div>
            {ipfsStatus.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="stat-desc">{ipfsStatus.service}</div>
      </div>
    </div>
  );
};

export default OverviewStats; 