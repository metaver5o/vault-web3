import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  KeyRound, FolderOpen, Plus, ChevronRight,
  Clock, Hash, RefreshCw, AlertCircle
} from "lucide-react";
import clsx from "clsx";
import type { VaultClient, SecretVersionEntry } from "@web3-vault/core";
import { loadConfig } from "../store/config.ts";

interface SecretsExplorerProps {
  vault: VaultClient | null;
}

interface PathEntry {
  path: string;
  latestVersion?: number;
  lastModified?: number;
  author?: string;
}

const WELL_KNOWN_PATHS = [
  "secret/myapp/db",
  "secret/myapp/api-keys",
  "secret/myapp/tls",
  "ssh/prod-bastion",
  "pki/root/ca",
];

export function SecretsExplorer({ vault }: SecretsExplorerProps) {
  const navigate = useNavigate();
  const [paths, setPaths] = useState<PathEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const cfg = loadConfig();

  // Load known paths from registry by checking well-known paths
  // In production this would query an indexer. For now we use local storage history.
  useEffect(() => {
    const stored = localStorage.getItem("vault-web3-known-paths");
    if (stored) {
      try { setPaths(JSON.parse(stored)); } catch {}
    }
  }, []);

  const filtered = paths.filter((p) =>
    search === "" || p.path.toLowerCase().includes(search.toLowerCase())
  );

  async function checkPath(path: string) {
    if (!vault) return;
    setLoading(true);
    setError(null);
    try {
      const versions = await vault.listVersions(path);
      const latest = versions[versions.length - 1];
      const entry: PathEntry = {
        path,
        latestVersion: latest?.version,
        lastModified: latest?.timestamp ? latest.timestamp * 1000 : undefined,
        author: latest?.author,
      };
      setPaths((prev) => {
        const next = prev.filter((p) => p.path !== path);
        next.unshift(entry);
        localStorage.setItem("vault-web3-known-paths", JSON.stringify(next.slice(0, 50)));
        return next.slice(0, 50);
      });
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-vault-border flex items-center gap-4">
        <div>
          <h2 className="text-lg font-semibold text-vault-text">Secrets</h2>
          <p className="text-sm text-vault-muted">
            Namespace: <span className="font-mono text-vault-accent">{cfg.defaultNamespace}/</span>
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => navigate("/secrets/write")}
          className="vault-btn-primary"
        >
          <Plus className="w-4 h-4" />
          New Secret
        </button>
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b border-vault-border">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by path…"
          className="vault-input max-w-sm"
        />
      </div>

      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 p-3 rounded bg-vault-red/10 border border-vault-red/20 text-vault-red text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Path list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {filtered.length === 0 && !loading && (
          <div className="text-center py-16 space-y-4">
            <KeyRound className="w-10 h-10 text-vault-muted mx-auto" />
            <div>
              <p className="text-vault-muted text-sm">No secrets tracked yet</p>
              <p className="text-vault-muted text-xs mt-1">
                Write a secret or enter a path below to load it
              </p>
            </div>

            {/* Quick load well-known paths */}
            <div className="mt-6 space-y-2 max-w-sm mx-auto">
              <p className="text-xs text-vault-muted text-left mb-2">Quick load:</p>
              {WELL_KNOWN_PATHS.map((p) => (
                <button
                  key={p}
                  onClick={() => checkPath(p)}
                  className="w-full text-left px-3 py-2 rounded border border-vault-border
                             text-xs font-mono text-vault-muted hover:text-vault-text
                             hover:border-vault-accent transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="space-y-1.5">
            {filtered.map((entry) => (
              <button
                key={entry.path}
                onClick={() => navigate(`/secrets/read?path=${encodeURIComponent(entry.path)}`)}
                className="w-full vault-card hover:border-vault-accent transition-colors text-left
                           flex items-center gap-4 py-3 px-4 rounded-lg"
              >
                <FolderOpen className="w-4 h-4 text-vault-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm text-vault-text truncate">{entry.path}</div>
                  {entry.lastModified && (
                    <div className="flex items-center gap-3 mt-1 text-xs text-vault-muted">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(entry.lastModified).toLocaleString()}
                      </span>
                      {entry.latestVersion !== undefined && (
                        <span className="flex items-center gap-1">
                          <Hash className="w-3 h-3" />
                          v{entry.latestVersion}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-vault-muted shrink-0" />
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-3 py-8 justify-center text-vault-muted text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Fetching from registry…
          </div>
        )}
      </div>
    </div>
  );
}
