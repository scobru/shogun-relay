import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";

interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  raw?: string;
  lineNumber?: number;
}

function ConsoleLogs() {
  const { isAuthenticated, getAuthHeaders } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    try {
      const res = await fetch("/api/v1/system/logs?tail=500&limit=500", {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success && data.logs) {
        setLogs(data.logs);
      }
    } catch (e) {
      console.error("Failed to fetch logs", e);
    } finally {
      if (loading) setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchLogs();
      const interval = setInterval(fetchLogs, 3000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, loading]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((log) => {
    const matchesFilter = filter === "all" || log.level?.toLowerCase() === filter;
    const matchesSearch = log.message?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const getLevelBadgeClass = (level: string) => {
    switch (level?.toLowerCase()) {
      case "error":
        return "badge-error";
      case "warn":
        return "badge-warning";
      case "debug":
        return "badge-info";
      default:
        return "badge-ghost";
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="alert alert-warning">
        <span>🔒</span>
        <span>Authentication required to view logs.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-120px)]">
      {/* Header / Controls */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4 flex-row items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <h2 className="card-title text-xl">📜 Console Logs</h2>
            <div className="flex bg-base-200 rounded-lg p-1">
              {["all", "info", "warn", "error"].map((l) => (
                <button
                  key={l}
                  className={`btn btn-xs ${filter === l ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setFilter(l)}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-grow max-w-md">
            <input
              type="text"
              placeholder="Search logs..."
              className="input input-bordered input-sm w-full"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="label cursor-pointer gap-2">
              <span className="label-text text-xs">Auto-scroll</span>
              <input
                type="checkbox"
                className="toggle toggle-primary toggle-sm"
                checked={autoScroll}
                onChange={() => setAutoScroll(!autoScroll)}
              />
            </label>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                setLoading(true);
                fetchLogs();
              }}
            >
              🔄 Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Logs View */}
      <div className="card bg-neutral text-neutral-content shadow-xl flex-1 overflow-hidden border border-base-content/10">
        <div
          ref={scrollRef}
          className="card-body p-2 font-mono text-[11px] leading-tight overflow-y-auto"
        >
          {loading ? (
            <div className="flex justify-center items-center h-full">
              <span className="loading loading-spinner loading-md"></span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-4 text-center opacity-50">No logs found matching criteria.</div>
          ) : (
            filteredLogs.map((log) => (
              <div key={log.id} className="flex gap-3 hover:bg-neutral-focus/50 px-2 py-0.5 group">
                <span className="opacity-30 whitespace-nowrap min-w-[140px]">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span
                  className={`badge badge-xs ${getLevelBadgeClass(log.level)} min-w-[50px] uppercase font-bold text-[9px]`}
                >
                  {log.level || "info"}
                </span>
                <span className="flex-1 break-all whitespace-pre-wrap opacity-90 group-hover:opacity-100">
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Stats Bar */}
      <div className="flex justify-between text-[10px] opacity-50 px-2">
        <span>
          Showing {filteredLogs.length} of {logs.length} loaded entries
        </span>
        <span>Polling interval: 3s</span>
      </div>
    </div>
  );
}

export default ConsoleLogs;
