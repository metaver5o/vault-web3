import { useState } from "react";
import { ScrollText, Search, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import type { VaultClient } from "@vault-web3/core";

interface AuditLogProps {
  vault: VaultClient | null;
}

interface AuditEntry {
  accessor: string;
  path: string;
  operation: string;
  granted: boolean;
  timestamp: number;
}

export function AuditLogPage({ vault }: AuditLogProps) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetch() {
    if (!vault || !path.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const log = await vault.getAuditLog(path.trim());
      setEntries(log);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-5 border-b border-vault-border">
        <h2 className="text-lg font-semibold text-vault-text flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-vault-accent" />
          Audit Log
        </h2>
        <p className="text-sm text-vault-muted mt-1">Immutable on-chain access history</p>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="secret/myapp/db"
            className="vault-input font-mono flex-1"
            onKeyDown={(e) => e.key === "Enter" && fetch()}
          />
          <button onClick={fetch} disabled={loading || !vault} className="vault-btn-primary">
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Load
          </button>
        </div>

        {error && (
          <div className="p-3 rounded bg-vault-red/10 border border-vault-red/20 text-vault-red text-sm">
            {error}
          </div>
        )}

        {entries.length > 0 && (
          <div className="vault-card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-vault-border text-xs text-vault-muted">
                  <th className="px-4 py-3 text-left font-medium">Time</th>
                  <th className="px-4 py-3 text-left font-medium">Accessor</th>
                  <th className="px-4 py-3 text-left font-medium">Operation</th>
                  <th className="px-4 py-3 text-left font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i} className="border-b border-vault-border last:border-0 hover:bg-vault-bg/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-vault-muted whitespace-nowrap">
                      {new Date(e.timestamp * 1000).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-vault-text">
                      {e.accessor.slice(0, 10)}…{e.accessor.slice(-4)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`vault-badge ${
                        e.operation === "write" ? "vault-badge-teal" :
                        e.operation === "read" ? "vault-badge-purple" :
                        e.operation === "delete" ? "vault-badge-red" : "vault-badge-muted"
                      }`}>
                        {e.operation}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {e.granted
                        ? <CheckCircle className="w-4 h-4 text-vault-green" />
                        : <XCircle className="w-4 h-4 text-vault-red" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {entries.length === 0 && !loading && !error && (
          <div className="text-center py-16 text-vault-muted text-sm">
            Enter a secret path and click Load to view its audit history
          </div>
        )}
      </div>
    </div>
  );
}
