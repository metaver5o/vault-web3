import { useState } from "react";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import clsx from "clsx";
import { HOSTED_NETWORKS, NETWORKS, networkName, registryFor, switchNetwork } from "../store/networks.ts";
import { loadConfig, patchConfig } from "../store/config.ts";

/**
 * Which network the vault is on, and buttons to switch. The vault follows the wallet:
 * Base Sepolia for trying it out, Base for real use.
 */
export function NetworkBar({ chainId, walletBacked }: { chainId: number | null; walletBacked: boolean }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cfg = loadConfig();

  if (cfg.networkMode === "custom") {
    return (
      <div className="px-6 py-1.5 border-b border-vault-border text-xs text-vault-muted flex items-center gap-2">
        Custom network settings (chain {cfg.chainId}).
        <button className="text-vault-accent hover:underline" onClick={() => patchConfig({ networkMode: "auto" })}>
          Follow my wallet's network instead
        </button>
      </div>
    );
  }
  if (!walletBacked) return null;

  const deployed = !!registryFor(chainId);
  const preset = chainId ? NETWORKS[chainId] : undefined;

  async function go(id: number) {
    setBusy(id); setErr(null);
    try { await switchNetwork(id); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div id="network-bar" className={clsx("px-6 py-2 border-b text-xs flex items-center gap-3 flex-wrap",
      deployed ? "border-vault-border text-vault-muted" : "border-vault-yellow/30 bg-vault-yellow/5 text-vault-yellow")}>
      {deployed ? (
        <span>
          Network: <span className="text-vault-text font-medium">{networkName(chainId)}</span>
          {preset?.testnet && " (testnet: free, for trying it out)"}
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          vault-web3 isn't deployed on {networkName(chainId)}. Switch to:
        </span>
      )}
      <div className="flex items-center gap-1.5">
        {HOSTED_NETWORKS.filter((id) => id !== chainId).map((id) => (
          <button key={id} onClick={() => go(id)} disabled={busy !== null || !registryFor(id)}
            title={registryFor(id) ? "" : "Not deployed yet"}
            className="vault-btn-secondary text-xs py-0.5 px-2 disabled:opacity-40">
            {busy === id ? <Loader2 className="w-3 h-3 animate-spin" /> : NETWORKS[id].name}
          </button>
        ))}
      </div>
      {deployed && preset?.faucet && (
        <a href={preset.faucet} target="_blank" rel="noopener noreferrer" className="text-vault-accent hover:underline inline-flex items-center gap-1">
          Need test ETH? Faucets <ExternalLink className="w-3 h-3" />
        </a>
      )}
      {err && <span className="text-vault-red">{err}</span>}
    </div>
  );
}
