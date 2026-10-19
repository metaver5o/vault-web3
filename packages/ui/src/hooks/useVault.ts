/**
 * Provides a VaultClient scoped to the current signer.
 * Re-creates the client whenever the signer changes OR when Settings are saved
 * (detected via localStorage 'storage' events).
 */

import { useState, useEffect } from "react";
import { VaultClient } from "@vault-web3/core";
import type { VaultSigner } from "@vault-web3/core";
import { effectiveConfig } from "../store/config.ts";

function buildClient(signer: VaultSigner, chainId: number | null): VaultClient | null {
  const cfg = effectiveConfig(chainId);
  try {
    return new VaultClient(
      {
        trezorManifest: { email: "vault@web3.local", appUrl: window.location.origin },
        ipfsApiUrl: cfg.ipfsApiUrl,
        rpcUrl: cfg.rpcUrl,
        registryAddress: cfg.registryAddress,
        chainId: cfg.chainId,
        accountIndex: cfg.accountIndex,
      },
      signer
    );
  } catch {
    // VaultClient throws if registryAddress is not configured (zero address).
    // Return null so the UI can render and show the Settings prompt instead
    // of crashing the whole component tree.
    return null;
  }
}

export function useVault(signer: VaultSigner | null, chainId: number | null = null): VaultClient | null {
  const [vault, setVault] = useState<VaultClient | null>(
    () => (signer ? buildClient(signer, chainId) : null)
  );

  // Rebuild when the signer or the wallet's network changes
  useEffect(() => {
    setVault(signer ? buildClient(signer, chainId) : null);
  }, [signer, chainId]);

  // Rebuild when Settings are saved (custom event fired by saveConfig in same tab)
  useEffect(() => {
    if (!signer) return;
    const handler = () => setVault(buildClient(signer, chainId));
    window.addEventListener("vault-config-saved", handler);
    return () => window.removeEventListener("vault-config-saved", handler);
  }, [signer, chainId]);

  return vault;
}
