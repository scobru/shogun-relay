import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";

interface ApiKey {
  keyId: string;
  name: string;
  keyPrefix: string;
  createdAt: number;
  lastUsed?: number;
}

const ApiKeys: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const fetchKeys = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/v1/api-keys", {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (data.success) {
        setKeys(data.keys);
      } else {
        setError(data.error || "Failed to fetch API keys");
      }
    } catch (err) {
      setError("Network error fetching API keys");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, [token]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName) return;

    try {
      setGenerating(true);
      const response = await fetch("/api/v1/api-keys/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await response.json();
      if (data.success) {
        setGeneratedToken(data.token);
        setNewKeyName("");
        fetchKeys();
      } else {
        alert(data.error || "Failed to generate API key");
      }
    } catch (err) {
      alert("Network error generating API key");
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm("Are you sure you want to revoke this API key?")) return;

    try {
      const response = await fetch(`/api/v1/api-keys/${keyId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (data.success) {
        fetchKeys();
      } else {
        alert(data.error || "Failed to revoke API key");
      }
    } catch (err) {
      alert("Network error revoking API key");
    }
  };

  return (
    <div className="space-y-6">
      <div className="card bg-base-100 shadow-xl border border-base-300">
        <div className="card-body">
          <h2 className="card-title text-2xl font-bold mb-4">API Keys</h2>
          <p className="text-base-content/70 mb-6">
            Generate stateless API keys for automated access to the relay (Uploads, IPFS, etc.). 
            These keys provide admin-level access to the endpoints they support.
          </p>

          <form onSubmit={handleGenerate} className="flex gap-4 mb-8">
            <input
              type="text"
              placeholder="Key Name (e.g. My Script)"
              className="input input-bordered flex-1"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              disabled={generating}
            />
            <button 
              type="submit" 
              className={`btn btn-primary ${generating ? "loading" : ""}`}
              disabled={generating || !newKeyName}
            >
              Generate New Key
            </button>
          </form>

          {generatedToken && (
            <div className="alert alert-success shadow-lg mb-8">
              <div>
                <h3 className="font-bold">New API Key Generated!</h3>
                <p className="text-sm">Copy this token now. It will not be shown again.</p>
                <div className="mt-2 p-2 bg-base-300 rounded font-mono break-all select-all">
                  {generatedToken}
                </div>
              </div>
              <div className="flex-none">
                <button className="btn btn-sm btn-ghost" onClick={() => setGeneratedToken(null)}>Close</button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Created</th>
                  <th>Last Used</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center">Loading...</td></tr>
                ) : keys.length === 0 ? (
                  <tr><td colSpan={5} className="text-center opacity-50 italic">No API keys found.</td></tr>
                ) : (
                  keys.map((key) => (
                    <tr key={key.keyId}>
                      <td className="font-medium">{key.name}</td>
                      <td className="font-mono text-xs">{key.keyPrefix}</td>
                      <td className="text-sm">{new Date(key.createdAt).toLocaleString()}</td>
                      <td className="text-sm">
                        {key.lastUsed ? new Date(key.lastUsed).toLocaleString() : "Never"}
                      </td>
                      <td>
                        <button 
                          className="btn btn-error btn-xs"
                          onClick={() => handleRevoke(key.keyId)}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiKeys;
