import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import {
  Eye, EyeOff, Copy, ArrowLeft, Loader2,
  AlertCircle, Clock, Hash, User, ExternalLink, History, Settings
} from "lucide-react";
import type { VaultClient, ReadSecretResponse, SecretVersionEntry } from "@web3-vault/core";

interface ReadSecretProps {
  vault: VaultClient | null;
}

export function ReadSecretPage({ vault }: ReadSecretProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialPath = params.get("path") ?? "";

  const [path, setPath] = useState(initialPath);
  const [version, setVersion] = useState("");
  const [result, setResult] = useState<ReadSecretResponse | null>(null);
  const [history, setHistory] = useState<SecretVersionEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function fetchSecret() {
    if (!vault || !path.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const ver = version.trim() ? parseInt(version, 10) : undefined;
      const res = await vault.read(path.trim(), ver);
      setResult(res);
      setHiddenKeys(new Set(Object.keys(res.data)));
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchHistory() {
    if (!vault || !path.trim()) return;
    try {
      const h = await vault.listVersions(path.trim());
      setHistory(h);
    } catch { }
  }

  function toggleHidden(key: string) {
    setHiddenKeys((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function copyValue(key: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-5 border-b border-vault-border flex items-center gap-4">
        <button onClick={() => navigate("/secrets")} className="text-vault-muted hover:text-vault-text">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-lg font-semibold text-vault-text">Read Secret</h2>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Registry not configured warning */}
        {!vault && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-vault-yellow/10 border border-vault-yellow/30">
            <AlertCircle className="w-4 h-4 text-vault-yellow mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-vault-yellow">Registry contract not configured</p>
              <p className="text-xs text-vault-muted mt-1">
                Go to{" "}
                <Link to="/settings" className="text-vault-accent hover:underline inline-flex items-center gap-1">
                  Settings <Settings className="w-3 h-3" />
                </Link>
                {" "}and set the deployed contract address before reading secrets.
              </p>
            </div>
          </div>
        )}
        {/* Path input */}
        <div className="flex gap-3">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="secret/myapp/db"
            className="vault-input font-mono flex-1"
            onKeyDown={(e) => e.key === "Enter" && fetchSecret()}
          />
          <input
            type="number"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="version"
            className="vault-input font-mono w-24"
            min={1}
          />
          <button
            onClick={fetchSecret}
            disabled={loading || !vault || !path.trim()}
            className="vault-btn-primary"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Decrypt"}
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded bg-vault-red/10 border border-vault-red/20">
            <AlertCircle className="w-4 h-4 text-vault-red mt-0.5 shrink-0" />
            <p className="text-sm text-vault-red">{error}</p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-4">
            {/* Metadata */}
            <div className="vault-card">
              <div className="grid grid-cols-2 gap-3 text-sm font-mono">
                <MetaRow icon={<Hash className="w-3.5 h-3.5" />} label="Version" value={`v${result.metadata.version}`} />
                <MetaRow icon={<Clock className="w-3.5 h-3.5" />} label="Updated"
                  value={new Date(result.metadata.updatedAt).toLocaleString()} />
                <MetaRow icon={<ExternalLink className="w-3.5 h-3.5" />} label="CID"
                  value={result.metadata.cid.slice(0, 20) + "…"} />
                <MetaRow icon={<User className="w-3.5 h-3.5" />} label="Engine"
                  value={result.metadata.engine} />
              </div>
            </div>

            {/* Data */}
            <div className="vault-card space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-vault-muted">Secret Data</span>
                <button
                  onClick={() => setHiddenKeys(
                    hiddenKeys.size === 0 ? new Set(Object.keys(result.data)) : new Set()
                  )}
                  className="text-xs text-vault-muted hover:text-vault-text transition-colors"
                >
                  {hiddenKeys.size === 0 ? "Hide all" : "Show all"}
                </button>
              </div>
              <div className="space-y-2">
                {Object.entries(result.data).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-3 p-2.5 rounded bg-vault-bg border border-vault-border">
                    <span className="font-mono text-sm text-vault-accent w-32 shrink-0 truncate">{key}</span>
                    <span className="font-mono text-sm text-vault-text flex-1 truncate">
                      {hiddenKeys.has(key) ? "•".repeat(Math.min(value.length, 20)) : value}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => toggleHidden(key)} className="text-vault-muted hover:text-vault-text transition-colors">
                        {hiddenKeys.has(key) ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => copyValue(key, value)} className="text-vault-muted hover:text-vault-text transition-colors">
                        {copiedKey === key ? <span className="text-vault-green text-xs">✓</span> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Version history */}
            <div>
              <button
                onClick={fetchHistory}
                className="vault-btn-secondary text-sm w-full justify-center"
              >
                <History className="w-4 h-4" />
                Load version history
              </button>
              {history && (
                <div className="mt-3 space-y-1.5">
                  {history.map((v) => (
                    <button
                      key={v.version}
                      onClick={() => { setVersion(String(v.version)); fetchSecret(); }}
                      className={`w-full text-left px-3 py-2 rounded border text-xs font-mono transition-colors
                        ${v.version === result.metadata.version
                          ? "border-vault-accent bg-vault-accent/5 text-vault-accent"
                          : "border-vault-border text-vault-muted hover:border-vault-border hover:text-vault-text"}`}
                    >
                      <span className="text-vault-text">v{v.version}</span>
                      <span className="mx-2 text-vault-border">|</span>
                      {new Date(v.timestamp * 1000).toLocaleString()}
                      <span className="mx-2 text-vault-border">|</span>
                      {v.author.slice(0, 10)}…
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-vault-muted">{icon}</span>
      <span className="text-vault-muted">{label}</span>
      <span className="text-vault-text truncate">{value}</span>
    </div>
  );
}
