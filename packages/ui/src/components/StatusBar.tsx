import { useEffect, useState } from "react";
import { Wifi, WifiOff, Circle } from "lucide-react";
import clsx from "clsx";
import { networkName } from "../store/networks.ts";
import { checkQSHaaSStatus } from "@vault-web3/core";
import { loadConfig } from "../store/config.ts";

interface StatusBarProps {
  address: string | null;
  signerType: string | null;
  chainId?: number;
}

export function StatusBar({ address, signerType, chainId }: StatusBarProps) {
  // null: no QSHaaS key configured, so the indicator stays hidden.
  const [qsStatus, setQsStatus] = useState<"checking" | "online" | "offline" | null>(null);

  useEffect(() => {
    const cfg = loadConfig();
    if (!cfg.qshaasApiKey) return;
    setQsStatus("checking");
    checkQSHaaSStatus({ apiUrl: cfg.qshaasApiUrl, apiKey: cfg.qshaasApiKey })
      .then((s) => setQsStatus(s.online ? "online" : "offline"))
      .catch(() => setQsStatus("offline"));
  }, []);

  return (
    <div className="flex items-center gap-4 px-5 py-2 border-b border-vault-border bg-vault-surface/60 text-xs text-vault-muted font-mono">
      {/* Chain */}
      <span className="flex items-center gap-1.5">
        <Circle className={clsx(
          "w-2 h-2 fill-current",
          address ? "text-vault-green" : "text-vault-muted"
        )} />
        {address ? networkName(chainId) : "Disconnected"}
      </span>

      {/* Signer */}
      {signerType && (
        <span className="capitalize text-vault-text">{signerType}</span>
      )}

      <span className="flex-1" />

      {/* QSHaaS status, only when a key is configured */}
      {qsStatus && <span className={clsx(
        "flex items-center gap-1.5 transition-colors",
        qsStatus === "online" ? "text-vault-purple" : "text-vault-muted"
      )}>
        {qsStatus === "online" ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
        QSHaaS {qsStatus === "online" ? "online" : qsStatus === "offline" ? "offline" : "…"}
      </span>}
    </div>
  );
}
