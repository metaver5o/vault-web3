/**
 * Provides a VaultClient scoped to the current signer.
 * Re-creates the client whenever the signer changes OR when Settings are saved
 * (detected via localStorage 'storage' events).
 */

import { useState, useEffect } from "react";
import { VaultClient } from "@web3-vault/core";
import type { VaultSigner } from "@web3-vault/core";
import { loadConfig } from "../store/config.ts";

function buildClient(signer: VaultSigner): VaultClient | null {
  const cfg = loadConfig();
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

export function useVault(signer: VaultSigner | null): VaultClient | null {
  const [vault, setVault] = useState<VaultClient | null>(
    () => (signer ? buildClient(signer) : null)
  );

  // Rebuild when signer changes
  useEffect(() => {
    setVault(signer ? buildClient(signer) : null);
  }, [signer]);

  // Rebuild when Settings are saved (custom event fired by saveConfig in same tab)
  useEffect(() => {
    if (!signer) return;
    const handler = () => setVault(buildClient(signer));
    window.addEventListener("vault-config-saved", handler);
    return () => window.removeEventListener("vault-config-saved", handler);
  }, [signer]);

  return vault;
}
