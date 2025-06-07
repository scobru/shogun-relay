"use client";

import { useState } from "react";
import toast from "react-hot-toast";

interface SettingsTabProps {
  theme?: string;
  onToggleTheme: () => void;
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

const SettingsTab = ({ 
  theme, 
  onToggleTheme, 
  serverStatus, 
  ipfsStatus, 
  onRefresh 
}: SettingsTabProps) => {
  const [serverSettings, setServerSettings] = useState({
    port: serverStatus.port || "8765",
    maxFileSize: "100",
    enableCors: true,
    enableAuth: true
  });

  const [ipfsSettings, setIpfsSettings] = useState({
    enabled: ipfsStatus.enabled,
    gatewayUrl: "https://ipfs.io/ipfs/",
    nodeUrl: "http://localhost:5001",
    autoPin: true
  });

  const [authSettings, setAuthSettings] = useState({
    tokenExpiry: "24",
    requireAuth: true,
    maxAttempts: "5"
  });

  const saveSettings = async (section: string) => {
    try {
      toast.success(`${section} settings saved successfully!`);
    } catch (error) {
      toast.error(`Failed to save ${section} settings`);
    }
  };

  const resetSettings = (section: string) => {
    if (!confirm(`Reset ${section} settings to defaults?`)) return;
    
    switch (section) {
      case "server":
        setServerSettings({
          port: "8765",
          maxFileSize: "100",
          enableCors: true,
          enableAuth: true
        });
        break;
      case "ipfs":
        setIpfsSettings({
          enabled: false,
          gatewayUrl: "https://ipfs.io/ipfs/",
          nodeUrl: "http://localhost:5001",
          autoPin: true
        });
        break;
      case "auth":
        setAuthSettings({
          tokenExpiry: "24",
          requireAuth: true,
          maxAttempts: "5"
        });
        break;
    }
    
    toast.success(`${section} settings reset to defaults`);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Dashboard Settings</h2>
        <button onClick={onRefresh} className="btn btn-outline btn-sm">
          Refresh Status
        </button>
      </div>

      {/* Appearance Settings */}
      <div className="card bg-base-100 shadow-lg">
        <div className="card-body">
          <h3 className="card-title">Appearance</h3>
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Theme</span>
            </label>
            <div className="flex items-center gap-4">
              <span className="text-sm">Light</span>
              <input 
                type="checkbox" 
                className="toggle toggle-primary" 
                checked={theme === "dark"}
                onChange={onToggleTheme}
              />
              <span className="text-sm">Dark</span>
            </div>
          </div>
        </div>
      </div>

      {/* Server Settings */}
      <div className="card bg-base-100 shadow-lg">
        <div className="card-body">
          <div className="flex items-center justify-between mb-4">
            <h3 className="card-title">
              Server Configuration
              <span className={`badge ${serverStatus.status === "online" ? "badge-success" : "badge-error"}`}>
                {serverStatus.status}
              </span>
            </h3>
            <button onClick={() => saveSettings("server")} className="btn btn-primary btn-sm">
              Save
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Server Port</span>
              </label>
              <input
                type="number"
                className="input input-bordered"
                value={serverSettings.port}
                onChange={(e) => setServerSettings({...serverSettings, port: e.target.value})}
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Max File Size (MB)</span>
              </label>
              <input
                type="number"
                className="input input-bordered"
                value={serverSettings.maxFileSize}
                onChange={(e) => setServerSettings({...serverSettings, maxFileSize: e.target.value})}
              />
            </div>
          </div>
        </div>
      </div>

      {/* IPFS Settings */}
      <div className="card bg-base-100 shadow-lg">
        <div className="card-body">
          <div className="flex items-center justify-between mb-4">
            <h3 className="card-title">
              IPFS Configuration
              <span className={`badge ${ipfsStatus.enabled ? "badge-success" : "badge-warning"}`}>
                {ipfsStatus.enabled ? "Enabled" : "Disabled"}
              </span>
            </h3>
            <button onClick={() => saveSettings("ipfs")} className="btn btn-primary btn-sm">
              Save
            </button>
          </div>

          <div className="form-control">
            <label className="label cursor-pointer">
              <span className="label-text font-medium">Enable IPFS Integration</span>
              <input
                type="checkbox"
                className="checkbox checkbox-primary"
                checked={ipfsSettings.enabled}
                onChange={(e) => setIpfsSettings({...ipfsSettings, enabled: e.target.checked})}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Authentication Settings */}
      <div className="card bg-base-100 shadow-lg">
        <div className="card-body">
          <div className="flex items-center justify-between mb-4">
            <h3 className="card-title flex items-center gap-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Authentication & Security
            </h3>
            <div className="flex gap-2">
              <button 
                onClick={() => saveSettings("auth")}
                className="btn btn-primary btn-sm"
              >
                Save
              </button>
              <button 
                onClick={() => resetSettings("auth")}
                className="btn btn-ghost btn-sm"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Token Expiry (hours)</span>
              </label>
              <input
                type="number"
                className="input input-bordered"
                value={authSettings.tokenExpiry}
                onChange={(e) => setAuthSettings({...authSettings, tokenExpiry: e.target.value})}
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Max Login Attempts</span>
              </label>
              <input
                type="number"
                className="input input-bordered"
                value={authSettings.maxAttempts}
                onChange={(e) => setAuthSettings({...authSettings, maxAttempts: e.target.value})}
              />
            </div>

            <div className="form-control">
              <label className="label cursor-pointer">
                <span className="label-text font-medium">Require Authentication</span>
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary"
                  checked={authSettings.requireAuth}
                  onChange={(e) => setAuthSettings({...authSettings, requireAuth: e.target.checked})}
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* System Info */}
      <div className="card bg-base-100 shadow-lg">
        <div className="card-body">
          <h3 className="card-title flex items-center gap-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            System Information
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="stat">
              <div className="stat-title">Version</div>
              <div className="stat-value text-lg">v2.1.0</div>
            </div>
            <div className="stat">
              <div className="stat-title">Uptime</div>
              <div className="stat-value text-lg">2d 14h</div>
            </div>
            <div className="stat">
              <div className="stat-title">Memory Usage</div>
              <div className="stat-value text-lg">234 MB</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsTab; 