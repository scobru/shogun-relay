import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

interface RegistryConfig {
  chainId: string;
  chainName: string;
  explorerUrl: string;
  registryAddress?: string;
  usdcAddress?: string;
}

interface RelayStatus {
  configured: boolean;
  registered: boolean;
  relayAddress: string;
  registryAddress?: string;
  relay?: {
    status: string;
    endpoint: string;
    registeredAt: string;
    totalDeals: number;
    stakedAmount: string;
    totalSlashed: string;
  };
}

interface Balances {
  eth: string;
  usdc: string;
}

interface RegistryParams {
  minStake: string;
  unstakingDelayDays: number;
}

interface Deal {
  dealId: string;
  cid: string;
  client: string;
  sizeMB: number;
  priceUSDC: string;
  active: boolean;
  griefed: boolean;
}

function Registry() {
  const { isAuthenticated, getAuthHeaders } = useAuth();
  const [config, setConfig] = useState<RegistryConfig | null>(null);
  const [status, setStatus] = useState<RelayStatus | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [params, setParams] = useState<RegistryParams | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [endpoint, setEndpoint] = useState("");
  const [gunPubKey, setGunPubKey] = useState("");
  const [stakeActionAmount, setStakeActionAmount] = useState("0");
  const [actionStatus, setActionStatus] = useState("");
  const [stakingMode, setStakingMode] = useState<"increase" | "unstake" | "withdraw">("increase");
  const [emergencyTokenAddress, setEmergencyTokenAddress] = useState("");
  const [emergencyAmount, setEmergencyAmount] = useState("");

  const truncateAddress = (addr: string) => (addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // Config
      const configRes = await fetch("/api/v1/registry/config");
      const configData = await configRes.json();
      setConfig(configData);
      if (configData?.usdcAddress && !emergencyTokenAddress) {
        setEmergencyTokenAddress(configData.usdcAddress);
      }

      // Status
      const statusRes = await fetch("/api/v1/registry/status");
      const statusData = await statusRes.json();
      setStatus(statusData);

      if (statusData.relay) {
        setEndpoint(statusData.relay.endpoint);
      }

      // Balances
      try {
        const balRes = await fetch("/api/v1/registry/balance");
        const balData = await balRes.json();
        if (balData.success) {
          setBalances(balData.balances);
        }
      } catch {}

      // Params
      try {
        const paramsRes = await fetch("/api/v1/registry/params");
        const paramsData = await paramsRes.json();
        if (paramsData.success) {
          setParams(paramsData.params);
        }
      } catch {}

      // Deals
      try {
        const dealsRes = await fetch("/api/v1/registry/deals");
        const dealsData = await dealsRes.json();
        if (dealsData.success) {
          setDeals(dealsData.deals || []);
        }
      } catch {}
    } catch (error) {
      console.error("Failed to fetch registry data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchServerKey = async () => {
    try {
      const res = await fetch("/health");
      const data = await res.json();
      if (data.relay?.pub) {
        setGunPubKey(data.relay.pub);
        setActionStatus("✅ Server key loaded");
      }
    } catch (error) {
      setActionStatus("❌ Failed to load server key");
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchAll();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, fetchAll]);

  const registerRelay = async () => {
    if (!endpoint || !gunPubKey || !stakeActionAmount) {
      setActionStatus("❌ Fill all fields");
      return;
    }
    setActionStatus("Registering...");
    try {
      const res = await fetch("/api/v1/registry/register", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, gunPubKey, stakeAmount: stakeActionAmount }),
      });
      const data = await res.json();
      if (data.success) {
        setActionStatus(
          "✅ Registered! " + (data.txHash ? `TX: ${data.txHash.slice(0, 10)}...` : "")
        );
        fetchAll();
      } else {
        setActionStatus("❌ " + (data.error || "Failed"));
      }
    } catch {
      setActionStatus("❌ Network error");
    }
  };

  const updateRelay = async () => {
    setActionStatus("Updating relay...");
    try {
      const res = await fetch("/api/v1/registry/update", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ newEndpoint: endpoint, newGunPubKey: gunPubKey }),
      });
      const data = await res.json();
      if (data.success) {
        setActionStatus("✅ Updated!");
        fetchAll();
      } else {
        setActionStatus("❌ Update failed: " + data.error);
      }
    } catch {
      setActionStatus("❌ Network error");
    }
  };

  const handleStakingAction = async () => {
    if (!stakeActionAmount || parseFloat(stakeActionAmount) <= 0) {
      setActionStatus("❌ Invalid amount");
      return;
    }
    setActionStatus(`Processing ${stakingMode}...`);
    try {
      let endpointUrl = "/api/v1/registry/stake/increase";
      if (stakingMode === "unstake") endpointUrl = "/api/v1/registry/stake/unstake";
      if (stakingMode === "withdraw") endpointUrl = "/api/v1/registry/stake/withdraw";

      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ amount: stakeActionAmount }),
      });
      const data = await res.json();
      if (data.success) {
        setActionStatus(
          `✅ ${stakingMode} successful! ` +
            (data.txHash ? `TX: ${data.txHash.slice(0, 10)}...` : "")
        );
        fetchAll();
      } else {
        setActionStatus("❌ Failed: " + (data.error || "Unknown error"));
      }
    } catch (e) {
      setActionStatus("❌ Network error");
    }
  };

  const handleEmergencyWithdraw = async () => {
    if (!emergencyTokenAddress || !emergencyAmount || parseFloat(emergencyAmount) <= 0) {
      setActionStatus("❌ Invalid token or amount");
      return;
    }
    setActionStatus("Processing emergency withdraw...");
    try {
      const res = await fetch("/api/v1/registry/emergency-withdraw", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenAddress: emergencyTokenAddress,
          amount: emergencyAmount,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionStatus(
          `✅ Emergency withdraw sent! ` + (data.txHash ? `TX: ${data.txHash.slice(0, 10)}...` : "")
        );
      } else {
        setActionStatus("❌ Failed: " + (data.error || "Unknown error"));
      }
    } catch {
      setActionStatus("❌ Network error");
    }
  };

  if (!isAuthenticated)
    return (
      <div className="alert alert-warning">
        <span className="text-2xl">🔒</span>
        <span>Authentication required to access Registry.</span>
      </div>
    );

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Header */}
      <div className="card bg-base-100 shadow">
        <div className="card-body flex-row items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="card-title text-2xl">📋 Registry Management</h2>
            <p className="text-base-content/70">On-chain relay registration & staking</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchAll}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
        <div className="stat">
          <div className="stat-title">On-Chain Status</div>
          <div
            className={`stat-value text-lg ${
              status?.relay?.status === "Active" ? "text-success" :
              status?.relay?.status === "Unstaking" ? "text-warning" :
              status?.relay?.status === "Slashed" ? "text-error" :
              status?.registered ? "text-info" : "text-warning"
            }`}
          >
            {status?.relay?.status === "Active" ? "✅ Active" :
             status?.relay?.status === "Unstaking" ? "⏳ Unstaking" :
             status?.relay?.status === "Slashed" ? "❌ Slashed" :
             status?.relay?.status === "Inactive" ? "⚪ Inactive" :
             status?.registered ? "✅ Registered" : "⚠️ Not Registered"}
          </div>
          {status?.relay?.status === "Unstaking" && (
            <div className="stat-desc text-warning">Pending unstake - not visible to clients</div>
          )}
        </div>
        {balances && (
          <>
            <div className="stat">
              <div className="stat-title">ETH Balance</div>
              <div className="stat-value">{parseFloat(balances.eth).toFixed(4)}</div>
            </div>
            <div className="stat">
              <div className="stat-title">USDC Balance</div>
              <div className="stat-value">{parseFloat(balances.usdc).toFixed(2)}</div>
            </div>
          </>
        )}
        {status?.relay && (
          <div className="stat">
            <div className="stat-title">Staked</div>
            <div className="stat-value text-primary">{status.relay.stakedAmount} USDC</div>
          </div>
        )}
      </div>

      {/* Actions */}
      {status?.configured && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title">
              {status.registered ? "Relay Management" : "Register Relay"}
            </h3>

            {/* Registration / Update Form */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Endpoint URL</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://..."
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">GunDB Pub Key</span>
                </label>
                <div className="join">
                  <input
                    type="text"
                    className="input input-bordered join-item flex-1"
                    value={gunPubKey}
                    onChange={(e) => setGunPubKey(e.target.value)}
                  />
                  <button className="btn join-item" onClick={fetchServerKey}>
                    Fetch
                  </button>
                </div>
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">
                    {status.registered ? "Update Info" : "Initial Stake"}
                  </span>
                </label>
                {status.registered ? (
                  <button className="btn btn-secondary" onClick={updateRelay}>
                    Update Info
                  </button>
                ) : (
                  <div className="join">
                    <input
                      type="number"
                      className="input input-bordered join-item w-24"
                      value={stakeActionAmount}
                      onChange={(e) => setStakeActionAmount(e.target.value)}
                    />
                    <button className="btn btn-primary join-item" onClick={registerRelay}>
                      Register
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Staking Controls */}
            {status.registered && (
              <div className="mt-6 pt-6 border-t border-base-300">
                <h4 className="font-bold mb-4">Staking Operations</h4>
                <div className="tabs tabs-boxed mb-4">
                  <button
                    className={`tab ${stakingMode === "increase" ? "tab-active" : ""}`}
                    onClick={() => setStakingMode("increase")}
                    disabled={status.relay?.status === "Unstaking"}
                  >
                    Increase Stake
                  </button>
                  <button
                    className={`tab ${stakingMode === "unstake" ? "tab-active" : ""}`}
                    onClick={() => setStakingMode("unstake")}
                    disabled={status.relay?.status !== "Active"}
                  >
                    Unstake
                  </button>
                  <button
                    className={`tab ${stakingMode === "withdraw" ? "tab-active" : ""}`}
                    onClick={() => setStakingMode("withdraw")}
                    disabled={status.relay?.status !== "Unstaking"}
                  >
                    Withdraw
                  </button>
                </div>
                <div className="flex items-center gap-4">
                  {stakingMode === "increase" && (
                    <input
                      type="number"
                      className="input input-bordered w-32"
                      value={stakeActionAmount}
                      onChange={(e) => setStakeActionAmount(e.target.value)}
                      placeholder="Amount USDC"
                    />
                  )}
                  <button className="btn btn-primary" onClick={handleStakingAction}>
                    {stakingMode === "increase"
                      ? "➕ Stake"
                      : stakingMode === "unstake"
                        ? "⏳ Request Unstake (All)"
                        : "💸 Withdraw All"}
                  </button>
                </div>
                <p className="text-sm text-base-content/60 mt-2">
                  Current Stake: <strong>{status.relay?.stakedAmount} USDC</strong>
                  {status.relay?.status === "Unstaking" && (
                    <span className="text-warning ml-2">• ⏳ Unstaking in progress (wait {params?.unstakingDelayDays || 7} days to withdraw)</span>
                  )}
                </p>
                {stakingMode === "unstake" && status.relay?.status === "Active" && (
                  <div className="alert alert-warning mt-2">
                    <span>⚠️ Unstaking will remove your relay from the active list. Your full stake of <strong>{status.relay?.stakedAmount} USDC</strong> will be locked for {params?.unstakingDelayDays || 7} days before withdrawal.</span>
                  </div>
                )}
              </div>
            )}

            {/* Emergency Withdraw */}
            {status.registered && (
              <div className="mt-6 pt-6 border-t border-base-300">
                <h4 className="font-bold mb-2 text-error">Emergency Withdraw</h4>
                <p className="text-sm text-base-content/70 mb-4">
                  Owner-only rescue for tokens stuck in the registry contract. Uses the relay signer
                  key.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text">Token Address</span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered"
                      value={emergencyTokenAddress}
                      onChange={(e) => setEmergencyTokenAddress(e.target.value)}
                      placeholder="0x..."
                    />
                  </div>
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text">Amount</span>
                    </label>
                    <input
                      type="number"
                      className="input input-bordered"
                      value={emergencyAmount}
                      onChange={(e) => setEmergencyAmount(e.target.value)}
                      placeholder="0.0"
                    />
                  </div>
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text">Action</span>
                    </label>
                    <button className="btn btn-error" onClick={handleEmergencyWithdraw}>
                      🚨 Emergency Withdraw
                    </button>
                  </div>
                </div>
              </div>
            )}

            {actionStatus && (
              <div
                className={`alert mt-4 ${actionStatus.includes("✅") ? "alert-success" : actionStatus.includes("❌") ? "alert-error" : "alert-info"}`}
              >
                <span>{actionStatus}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Deals List */}
      {status?.registered && deals.length > 0 && (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h3 className="card-title">On-Chain Deals ({deals.length})</h3>
            <div className="overflow-x-auto">
              <table className="table table-zebra">
                <thead>
                  <tr>
                    <th>CID</th>
                    <th>Client</th>
                    <th>Size</th>
                    <th>Price</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deals.slice(0, 10).map((d: Deal) => (
                    <tr key={d.dealId}>
                      <td className="font-mono text-xs" title={d.cid}>
                        {d.cid.slice(0, 10)}...
                      </td>
                      <td className="font-mono text-xs">{truncateAddress(d.client)}</td>
                      <td>{d.sizeMB} MB</td>
                      <td>
                        <strong>{d.priceUSDC} USDC</strong>
                      </td>
                      <td>
                        {d.griefed ? (
                          <span className="badge badge-error">⚠️ Griefed</span>
                        ) : d.active ? (
                          <span className="badge badge-success">✅ Active</span>
                        ) : (
                          <span className="badge badge-ghost">⏸️ Inactive</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Registry;
