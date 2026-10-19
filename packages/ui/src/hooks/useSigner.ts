/**
 * Manages the active VaultSigner (Trezor, MetaMask or YubiKey).
 * Provides connect/disconnect and exposes the current address + signer type.
 */

import { useState, useCallback, useEffect } from "react";
import { MetaMaskVault, TrezorVault, YubiKeyVault, YubiKeyNotReady, registerYubiKey, explainWebAuthnError, detectWallet } from "@vault-web3/core";
import type { VaultSigner, YubiKeyCredential } from "@vault-web3/core";
import { loadConfig } from "../store/config.ts";

const YUBIKEY_KEY = "vault-web3-yubikey";   // the registered credential id; not secret

export function hasRegisteredYubiKey(): boolean {
  return !!localStorage.getItem(YUBIKEY_KEY);
}

export interface SignerState {
  signer: VaultSigner | null;
  address: string | null;
  signerType: "trezor" | "metamask" | "yubikey" | null;
  connecting: boolean;
  error: string | null;
  /** Step-by-step fix when the error is a hardware key that isn't ready. */
  howto?: string | null;
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

  // YubiKey: secrets are keyed from the key's PRF; a browser wallet signs the registry transactions.
  const connectYubiKey = useCallback(async () => {
    setState((s) => ({ ...s, connecting: true, error: null, howto: null }));
    try {
      if (!window.ethereum) {
        throw new YubiKeyNotReady("unknown", "A YubiKey can't sign Ethereum transactions.",
          "Install MetaMask (or any browser wallet) for the on-chain writes. The YubiKey still protects the secrets: only it can derive the keys.");
      }
      let cred: YubiKeyCredential | null = JSON.parse(localStorage.getItem(YUBIKEY_KEY) ?? "null");
      if (!cred) {
        cred = await registerYubiKey({ userName: "vault-web3" });
        localStorage.setItem(YUBIKEY_KEY, JSON.stringify(cred));
      }
      const wallet = await new MetaMaskVault(loadConfig().chainId).getEthersSigner();
      const vault = new YubiKeyVault(cred, wallet);
      await vault.prf("vault-web3/connect-check");   // one touch now, so a key that isn't ready fails here with a how-to
      setState({ signer: vault, address: await vault.getAddress(), signerType: "yubikey", connecting: false, error: null, howto: null, walletAvailable: detectWallet() });
    } catch (err: unknown) {
      const e = err instanceof YubiKeyNotReady ? err : (err as { name?: string })?.name ? explainWebAuthnError(err) : null;
      setState((s) => ({ ...s, connecting: false, error: e ? e.message : (err as Error).message, howto: e?.howto ?? null }));
    }
  }, []);

  const forgetYubiKey = useCallback(() => { localStorage.removeItem(YUBIKEY_KEY); setState((s) => ({ ...s, error: null, howto: null })); }, []);

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

  return { ...state, connectMetaMask, connectTrezor, connectYubiKey, forgetYubiKey, disconnect };
}
