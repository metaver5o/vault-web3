/**
 * Manages the active VaultSigner (Trezor or MetaMask).
 * Provides connect/disconnect and exposes the current address + signer type.
 */

import { useState, useCallback, useEffect } from "react";
import { MetaMaskVault, TrezorVault, detectWallet } from "@web3-vault/core";
import type { VaultSigner } from "@web3-vault/core";
import { loadConfig } from "../store/config.ts";

export interface SignerState {
  signer: VaultSigner | null;
  address: string | null;
  signerType: "trezor" | "metamask" | null;
  connecting: boolean;
  error: string | null;
  walletAvailable: "metamask" | "other-eip1193" | "none";
}

export function useSigner() {
  const [state, setState] = useState<SignerState>({
    signer: null,
    address: null,
    signerType: null,
    connecting: false,
    error: null,
    walletAvailable: detectWallet(),
  });

  // Re-detect on mount (wallet extension may load asynchronously)
  useEffect(() => {
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, walletAvailable: detectWallet() }));
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const connectMetaMask = useCallback(async () => {
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const cfg = loadConfig();
      const vault = new MetaMaskVault(cfg.chainId);
      const address = await vault.getAddress();
      setState({
        signer: vault,
        address,
        signerType: "metamask",
        connecting: false,
        error: null,
        walletAvailable: detectWallet(),
      });

      // React to account/chain changes
      vault.onAccountChange((newAddr) => {
        setState((s) => ({ ...s, address: newAddr }));
      });
      vault.onChainChange((_chainId) => {
        // Chain changed — reset connection and ask user to reconnect
        setState((s) => ({
          ...s,
          signer: null,
          address: null,
          signerType: null,
          error: "Chain changed — please reconnect.",
        }));
        vault.dispose();
      });
    } catch (err: unknown) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: (err as Error).message,
      }));
    }
  }, []);

  const connectTrezor = useCallback(async () => {
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const cfg = loadConfig();
      const vault = new TrezorVault({
        trezorManifest: { email: "vault@local.dev", appUrl: "http://localhost:3000" },
        ipfsApiUrl: cfg.ipfsApiUrl,
        rpcUrl: cfg.rpcUrl,
        registryAddress: cfg.registryAddress,
        chainId: cfg.chainId,
        accountIndex: cfg.accountIndex,
      });
      const address = await vault.getAddress();
      setState({
        signer: vault,
        address,
        signerType: "trezor",
        connecting: false,
        error: null,
        walletAvailable: detectWallet(),
      });
    } catch (err: unknown) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: (err as Error).message,
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    state.signer?.dispose();
    setState((s) => ({
      ...s,
      signer: null,
      address: null,
      signerType: null,
      error: null,
    }));
  }, [state.signer]);

  return { ...state, connectMetaMask, connectTrezor, disconnect };
}
