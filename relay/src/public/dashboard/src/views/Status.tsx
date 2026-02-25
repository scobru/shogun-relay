import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";

interface HealthData {
  status: string;
  relayName: string;
  version?: string;
  uptime?: number;
}

interface StatsData {
  peers?: { count: number };
  memory?: { heapUsed: number };
}

function Status() {
  const { isAuthenticated, getAuthHeaders } = useAuth();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [healthRes, statsRes] = await Promise.all([
          fetch("/api/v1/health", { headers: getAuthHeaders() }),
          fetch("/api/v1/system/stats.json", { headers: getAuthHeaders() }),
        ]);

        const healthData = await healthRes.json();
        const statsData = await statsRes.json();

        setHealth(healthData.data || healthData);
        setStats(statsData);
      } catch (error) {
        console.error("Failed to fetch status:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (ms: number) => {
    const hours = Math.floor(ms / 1000 / 60 / 60);
    const minutes = Math.floor((ms / 1000 / 60) % 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Welcome Card */}
      <div className="card bg-gradient-to-r from-primary to-secondary text-primary-content">
        <div className="card-body flex-row items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-5xl">⚡</div>
            <div>
              <h2 className="card-title text-2xl">{health?.relayName || "Shogun Relay"}</h2>
              <p className="opacity-80">Decentralized infrastructure powered by GunDB & IPFS</p>
            </div>
          </div>
          <div className="badge badge-lg gap-2 bg-white/20 border-0">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
            Relay Online
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
        <div className="stat">
          <div className="stat-figure text-primary text-3xl">🌐</div>
          <div className="stat-title">Connected Peers</div>
          <div className="stat-value text-primary">{stats?.peers?.count || 0}</div>
        </div>
        <div className="stat">
          <div className="stat-figure text-secondary text-3xl">💾</div>
          <div className="stat-title">Memory</div>
          <div className="stat-value text-secondary">
            {stats?.memory?.heapUsed ? Math.round(stats.memory.heapUsed / 1024 / 1024) : 0}
          </div>
          <div className="stat-desc">MB used</div>
        </div>
        <div className="stat">
          <div className="stat-figure text-accent text-3xl">⏱️</div>
          <div className="stat-title">Uptime</div>
          <div className="stat-value text-accent">
            {health?.uptime ? formatUptime(health.uptime * 1000) : "--"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-figure text-info text-3xl">📦</div>
          <div className="stat-title">Version</div>
          <div className="stat-value text-info text-xl">{health?.version || "--"}</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            to="/files"
            className="card bg-base-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="card-body items-center text-center">
              <span className="text-4xl mb-2">📁</span>
              <h4 className="card-title">Upload Files</h4>
              <p className="text-base-content/60 text-sm">Pin files to IPFS</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Auth Warning */}
      {!isAuthenticated && (
        <div role="alert" className="alert alert-warning">
          <span className="text-2xl">🔒</span>
          <div>
            <h3 className="font-bold">Limited Access Mode</h3>
            <div className="text-sm">Enter admin password in Settings to unlock all features.</div>
          </div>
          <Link to="/settings" className="btn btn-sm">
            Go to Settings
          </Link>
        </div>
      )}
    </div>
  );
}

export default Status;
