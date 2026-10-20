import { Circle } from "lucide-react";
import clsx from "clsx";
import { networkName } from "../store/networks.ts";

interface StatusBarProps {
  address: string | null;
  signerType: string | null;
  chainId?: number;
}

export function StatusBar({ address, signerType, chainId }: StatusBarProps) {
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
    </div>
  );
}
