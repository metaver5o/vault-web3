import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Plus, Trash2, CheckCircle, AlertCircle,
  ArrowLeft, Loader2, Copy, Settings
} from "lucide-react";
import type { VaultClient } from "@vault-web3/core";
import { QuantumSeedField } from "../components/QuantumSeedField.tsx";
import { loadConfig, patchConfig } from "../store/config.ts";

interface WriteSecretProps {
  vault: VaultClient | null;
}

interface KVPair {
  id: number;
  key: string;
  value: string;
  hidden: boolean;
}

let nextId = 0;

export function WriteSecretPage({ vault }: WriteSecretProps) {
  const navigate = useNavigate();
  const cfg = loadConfig();

  const [path, setPath] = useState(cfg.defaultNamespace + "/");
  const [pairs, setPairs] = useState<KVPair[]>([
    { id: nextId++, key: "", value: "", hidden: true },
  ]);
  const [useQuantum, setUseQuantum] = useState(cfg.useQuantumSeedByDefault);
  const [qshaasKey, setQshaasKey] = useState(cfg.qshaasApiKey);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    version: number; cid: string; txHash: string; quantumJobId?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function addPair() {
    setPairs((p) => [...p, { id: nextId++, key: "", value: "", hidden: true }]);
  }
  function removePair(id: number) {
    setPairs((p) => p.filter((x) => x.id !== id));
  }
  function updatePair(id: number, field: "key" | "value", val: string) {
    setPairs((p) => p.map((x) => (x.id === id ? { ...x, [field]: val } : x)));
  }
  function toggleHidden(id: number) {
    setPairs((p) => p.map((x) => (x.id === id ? { ...x, hidden: !x.hidden } : x)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vault) return setError("No wallet connected");
    if (!path.trim()) return setError("Path is required");

    const data: Record<string, string> = {};
    for (const pair of pairs) {
      if (pair.key.trim()) data[pair.key.trim()] = pair.value;
    }
    if (Object.keys(data).length === 0) return setError("At least one key=value pair required");

    // Persist QSHaaS config
    patchConfig({ qshaasApiKey: qshaasKey, useQuantumSeedByDefault: useQuantum });

    setSubmitting(true);
    setError(null);
    try {
      const res = await vault.write({
        path: path.trim(),
        data,
        useQuantumSeed: useQuantum,
        qshaasApiKey: qshaasKey || undefined,
        qshaasApiUrl: cfg.qshaasApiUrl,
      });
      setResult(res);

      // Track path
      const known = JSON.parse(localStorage.getItem("vault-web3-known-paths") ?? "[]");
      const updated = [{ path: path.trim(), latestVersion: res.version, lastModified: res.timestamp }, ...known.filter((p: any) => p.path !== path.trim())].slice(0, 50);
      localStorage.setItem("vault-web3-known-paths", JSON.stringify(updated));
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="vault-card max-w-md w-full space-y-5">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-vault-green shrink-0" />
            <h3 className="text-lg font-semibold text-vault-green">Secret stored</h3>
          </div>

          <div className="space-y-3 font-mono text-sm">
            <Row label="Path" value={path} />
            <Row label="Version" value={`v${result.version}`} />
            <Row label="CID" value={result.cid} copyable />
            <Row label="Tx" value={result.txHash} copyable />
            {result.quantumJobId && (
              <Row label="Quantum Job" value={result.quantumJobId} />
            )}
          </div>

          {result.quantumJobId && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-vault-purple/10 border border-vault-purple/20 text-xs text-vault-purple">
              <span>⚛</span>
              DEK mixed with quantum entropy from QSHaaS
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setResult(null)} className="vault-btn-secondary flex-1">
              Write another
            </button>
            <button onClick={() => navigate("/secrets")} className="vault-btn-primary flex-1">
              View secrets
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-5 border-b border-vault-border flex items-center gap-4">
        <button onClick={() => navigate("/secrets")} className="text-vault-muted hover:text-vault-text transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-lg font-semibold text-vault-text">Write Secret</h2>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Registry not configured warning */}
        {!vault && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-vault-yellow/10 border border-vault-yellow/30">
            <AlertCircle className="w-4 h-4 text-vault-yellow mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-vault-yellow">Registry contract not configured</p>
              <p className="text-xs text-vault-muted mt-1">
                The vault registry address is missing or set to the zero address.
                Go to{" "}
                <Link to="/settings" className="text-vault-accent hover:underline inline-flex items-center gap-1">
                  Settings <Settings className="w-3 h-3" />
                </Link>
                {" "}and set the deployed contract address before writing secrets.
              </p>
            </div>
          </div>
        )}
        {/* Path */}
        <div>
          <label className="block text-sm text-vault-muted mb-2">
            Secret Path
          </label>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="secret/myapp/db"
            className="vault-input font-mono"
            required
          />
          <p className="text-xs text-vault-muted mt-1.5">
            Format: <code className="text-vault-accent">namespace/app/name</code>
          </p>
        </div>

        {/* Key/Value pairs */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm text-vault-muted">Data</label>
            <button type="button" onClick={addPair} className="vault-btn-secondary text-xs py-1 px-2">
              <Plus className="w-3.5 h-3.5" /> Add field
            </button>
          </div>
          <div className="space-y-2">
            {pairs.map((pair) => (
              <div key={pair.id} className="flex gap-2 items-start">
                <input
                  type="text"
                  value={pair.key}
                  onChange={(e) => updatePair(pair.id, "key", e.target.value)}
                  placeholder="key"
                  className="vault-input font-mono flex-1"
                />
                <div className="relative flex-1">
                  <input
                    type={pair.hidden ? "password" : "text"}
                    value={pair.value}
                    onChange={(e) => updatePair(pair.id, "value", e.target.value)}
                    placeholder="value"
                    className="vault-input font-mono w-full pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => toggleHidden(pair.id)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-vault-muted hover:text-vault-text text-xs"
                  >
                    {pair.hidden ? "show" : "hide"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removePair(pair.id)}
                  className="p-2 text-vault-muted hover:text-vault-red transition-colors"
                  disabled={pairs.length === 1}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Quantum Seed */}
        <QuantumSeedField
          enabled={useQuantum}
          apiKey={qshaasKey}
          apiUrl={cfg.qshaasApiUrl}
          onToggle={setUseQuantum}
          onApiKeyChange={setQshaasKey}
        />

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 rounded bg-vault-red/10 border border-vault-red/20">
            <AlertCircle className="w-4 h-4 text-vault-red mt-0.5 shrink-0" />
            <p className="text-sm text-vault-red">{error}</p>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || !vault}
          className="vault-btn-primary w-full justify-center py-2.5"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Confirm in wallet…
            </>
          ) : (
            "Encrypt & Store"
          )}
        </button>

        {submitting && (
          <p className="text-center text-xs text-vault-muted">
            Two confirmations required: KEK derivation + on-chain tx
          </p>
        )}
      </form>
    </div>
  );
}

function Row({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex gap-3">
      <span className="text-vault-muted w-20 shrink-0">{label}</span>
      <span className="text-vault-text break-all flex-1">{value}</span>
      {copyable && (
        <button onClick={copy} className="text-vault-muted hover:text-vault-text transition-colors shrink-0">
          <Copy className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
