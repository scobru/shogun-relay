import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";

interface ServiceStatus {
  name: string;
  status: "online" | "offline" | "error" | "maintenance";
  uptime?: string;
  lastCheck?: number;
  pid?: number;
  logs?: string[];
}

function Services() {
  const { isAuthenticated, getAuthHeaders } = useAuth();
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [serviceLogs, setServiceLogs] = useState<string[]>([]);

  const fetchServices = async () => {
    try {
      const res = await fetch("/api/v1/services/status", { headers: getAuthHeaders() });
      const data = await res.json();

      if (data.success && data.services) {
        const serviceList: ServiceStatus[] = Object.entries(data.services).map(
          ([key, value]: [string, any]) => {
            const status = value.status === "running" ? "online" : "offline";
            let displayName = key.toUpperCase();
            if (key === "ipfs") displayName = "IPFS Node";
            if (key === "gun") displayName = "Gun Relay";
            if (key === "relay") displayName = "Relay Core";
            if (key === "rpc") displayName = "RPC Server";

            if (key === "proxy") displayName = "Proxy Service";
            if (key === "gateway") displayName = "IPFS Gateway";
            return {
              name: displayName,
              status: status as "online" | "offline",
              uptime: value.uptime,
              pid: value.pid || 0,
            };
          }
        );
        setServices(serviceList);
      } else {
        setServices([
          { name: "Gun Relay", status: "online", uptime: "2d 4h", pid: 1234 },
          { name: "IPFS Node", status: "online", uptime: "5d 1h", pid: 5678 },
          { name: "RPC Server", status: "online", uptime: "12h", pid: 8822 },
        ]);
      }
    } catch (e) {
      console.error("Failed to fetch services", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) fetchServices();
  }, [isAuthenticated]);

  const handleServiceAction = async (serviceName: string, action: "restart" | "stop" | "start") => {
    if (!confirm(`${action.toUpperCase()} service: ${serviceName}?`)) return;
    setLoadingAction(serviceName);
    try {
      await fetch("/api/v1/system/services/control", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ service: serviceName, action }),
      });
      setTimeout(() => {
        fetchServices();
        setLoadingAction(null);
      }, 2000);
    } catch (e) {
      console.error(e);
      setLoadingAction(null);
    }
  };

  const handleGlobalAction = async (action: "health" | "restart-all") => {
    if (action === "restart-all" && !confirm("Restart ALL services?")) return;
    setRefreshing(true);
    try {
      if (action === "health") {
        const res = await fetch("/health");
        const data = await res.json();
        alert(`Health: ${data.status}\nUptime: ${data.uptime?.seconds}s`);
      } else {
        await fetch("/api/v1/system/services/restart-all", {
          method: "POST",
          headers: getAuthHeaders(),
        });
        alert("Restart sent.");
        setTimeout(fetchServices, 5000);
      }
    } catch (e) {
      alert("Failed: " + e);
    } finally {
      setRefreshing(false);
    }
  };

  const fetchLogs = async (serviceName: string) => {
    setSelectedService(serviceName);
    setServiceLogs(["Loading logs..."]);
    try {
      const res = await fetch(`/api/v1/system/services/${serviceName}/logs`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      setServiceLogs(data.logs || ["No logs available."]);
    } catch {
      setServiceLogs(["Error fetching logs."]);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="alert alert-warning">
        <span>🔒</span>
        <span>Authentication required to view services.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Header */}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body flex-row items-center justify-between">
          <div>
            <h2 className="card-title">🛠️ System Services</h2>
            <p className="text-base-content/60">Monitor and control relay subsystems</p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                setRefreshing(true);
                fetchServices();
              }}
              disabled={refreshing}
            >
              {refreshing ? <span className="loading loading-spinner loading-xs"></span> : "🔄"}{" "}
              Refresh
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleGlobalAction("health")}
              disabled={refreshing}
            >
              ❤️ Health
            </button>
            <button
              className="btn btn-warning btn-sm"
              onClick={() => handleGlobalAction("restart-all")}
              disabled={refreshing}
            >
              ⚡ Restart All
            </button>
          </div>
        </div>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full flex justify-center p-8">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : (
          services.map((svc) => (
            <div key={svc.name} className="card bg-base-100 shadow-sm">
              <div className="card-body">
                <div className="flex items-center justify-between">
                  <h3 className="card-title text-base">{svc.name}</h3>
                  <div
                    className={`badge ${svc.status === "online" ? "badge-success" : "badge-error"} gap-1`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${svc.status === "online" ? "bg-success" : "bg-error"}`}
                    ></span>
                    {svc.status}
                  </div>
                </div>
                <div className="text-sm text-base-content/60 mt-2">
                  <p>Uptime: {svc.uptime || "N/A"}</p>
                  <p>PID: {svc.pid || "-"}</p>
                </div>
                <div className="card-actions justify-end mt-4">
                  <button className="btn btn-ghost btn-xs" onClick={() => fetchLogs(svc.name)}>
                    📃 Logs
                  </button>
                  <button
                    className="btn btn-warning btn-xs"
                    onClick={() => handleServiceAction(svc.name, "restart")}
                    disabled={loadingAction === svc.name}
                  >
                    {loadingAction === svc.name ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      "⚡"
                    )}{" "}
                    Restart
                  </button>
                  {svc.status === "online" ? (
                    <button
                      className="btn btn-error btn-xs"
                      onClick={() => handleServiceAction(svc.name, "stop")}
                      disabled={loadingAction === svc.name}
                    >
                      🛑 Stop
                    </button>
                  ) : (
                    <button
                      className="btn btn-success btn-xs"
                      onClick={() => handleServiceAction(svc.name, "start")}
                      disabled={loadingAction === svc.name}
                    >
                      ▶ Start
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Logs Modal */}
      {selectedService && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-3xl">
            <h3 className="font-bold text-lg">Logs: {selectedService}</h3>
            <div className="bg-base-300 rounded-lg p-4 mt-4 max-h-96 overflow-y-auto font-mono text-xs">
              {serviceLogs.map((log, i) => (
                <div key={i} className="py-0.5 border-b border-base-content/10">
                  {log}
                </div>
              ))}
            </div>
            <div className="modal-action">
              <button className="btn" onClick={() => setSelectedService(null)}>
                Close
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setSelectedService(null)}>close</button>
          </form>
        </dialog>
      )}
    </div>
  );
}

export default Services;
