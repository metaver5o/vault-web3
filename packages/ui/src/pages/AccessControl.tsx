import { useState } from "react";
import { Users, Plus, Trash2, Loader2, AlertCircle, CheckCircle, Clock } from "lucide-react";
import type { VaultClient } from "@vault-web3/core";

interface AccessControlProps {
  vault: VaultClient | null;
}

type Role = "owner" | "admin" | "writer" | "reader";

const ROLE_COLORS: Record<Role, string> = {
  owner: "vault-badge-red",
  admin: "vault-badge-yellow",
  writer: "vault-badge-teal",
  reader: "vault-badge-purple",
};

export function AccessControlPage({ vault }: AccessControlProps) {
  const [path, setPath] = useState("");
  const [address, setAddress] = useState("");
  const [role, setRole] = useState<Role>("reader");
  const [expiresAt, setExpiresAt] = useState("");
  const [multiSig, setMultiSig] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Check policy
  const [checkPath, setCheckPath] = useState("");
  const [checkAddress, setCheckAddress] = useState("");
  const [checkRole, setCheckRole] = useState<Role>("reader");
  const [checkResult, setCheckResult] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!vault) return setError("No wallet connected");
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const txHash = await vault.grantRole(path, address, role, {
        expiresAt: expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : undefined,
        multiSigRequired: multiSig,
      });
      setSuccess(`Role granted. Tx: ${txHash}`);
      setAddress("");
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!vault) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const has = await vault.checkAccess(checkPath, checkAddress, checkRole);
      setCheckResult(has);
    } catch {
      setCheckResult(false);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-5 border-b border-vault-border">
        <h2 className="text-lg font-semibold text-vault-text flex items-center gap-2">
          <Users className="w-5 h-5 text-vault-accent" />
          Access Control
        </h2>
        <p className="text-sm text-vault-muted mt-1">Path-scoped role-based access control — on-chain</p>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        {/* Grant role */}
        <div className="vault-card space-y-5">
          <h3 className="text-sm font-semibold text-vault-text">Grant Role</h3>
          <form onSubmit={handleGrant} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-vault-muted mb-1.5">Secret Path</label>
                <input type="text" value={path} onChange={(e) => setPath(e.target.value)}
                  placeholder="secret/myapp/db" className="vault-input font-mono text-sm" required />
              </div>
              <div>
                <label className="block text-xs text-vault-muted mb-1.5">Grantee Address</label>
                <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
                  placeholder="0x…" className="vault-input font-mono text-sm" required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-vault-muted mb-1.5">Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}
                  className="vault-input text-sm">
                  <option value="reader">reader</option>
                  <option value="writer">writer</option>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-vault-muted mb-1.5">
                  Expires (optional)
                </label>
                <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                  className="vault-input text-sm" />
              </div>
            </div>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input type="checkbox" checked={multiSig} onChange={(e) => setMultiSig(e.target.checked)}
                className="w-4 h-4 accent-vault-accent" />
              <span className="text-sm text-vault-muted">Require multi-sig for this path</span>
            </label>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded bg-vault-red/10 border border-vault-red/20 text-vault-red text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 p-3 rounded bg-vault-green/10 border border-vault-green/20 text-vault-green text-sm">
                <CheckCircle className="w-4 h-4 shrink-0" /> {success}
              </div>
            )}

            <button type="submit" disabled={submitting || !vault} className="vault-btn-primary">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Grant Role (on-chain tx)
            </button>
          </form>
        </div>

        {/* Check access */}
        <div className="vault-card space-y-5">
          <h3 className="text-sm font-semibold text-vault-text">Check Access</h3>
          <form onSubmit={handleCheck} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <input type="text" value={checkPath} onChange={(e) => setCheckPath(e.target.value)}
                placeholder="secret/…" className="vault-input font-mono text-sm col-span-1" />
              <input type="text" value={checkAddress} onChange={(e) => setCheckAddress(e.target.value)}
                placeholder="0x…" className="vault-input font-mono text-sm" />
              <select value={checkRole} onChange={(e) => setCheckRole(e.target.value as Role)}
                className="vault-input text-sm">
                <option value="reader">reader</option>
                <option value="writer">writer</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={checking || !vault} className="vault-btn-secondary">
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check"}
              </button>
              {checkResult !== null && (
                <div className={`flex items-center gap-2 text-sm ${checkResult ? "text-vault-green" : "text-vault-red"}`}>
                  {checkResult ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {checkResult ? "Access granted" : "Access denied"}
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Role reference */}
        <div className="vault-card">
          <h3 className="text-sm font-semibold text-vault-text mb-4">Role Hierarchy</h3>
          <div className="space-y-2 text-sm">
            {(["owner", "admin", "writer", "reader"] as Role[]).map((r) => (
              <div key={r} className="flex items-center gap-3">
                <span className={`vault-badge ${ROLE_COLORS[r]} w-16 justify-center`}>{r}</span>
                <span className="text-vault-muted text-xs">
                  {{
                    owner: "Full control: grant/revoke all roles, delete secrets",
                    admin: "Write secrets + grant reader/writer roles",
                    writer: "Create and update secrets on scoped paths",
                    reader: "Read-only access to decrypted secrets",
                  }[r]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
