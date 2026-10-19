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
  /** The wallet's current chain (null before connecting or without a wallet). */
  chainId?: number | null;
}

async function walletChainId(): Promise<number | null> {
  try { return parseInt(String(await window.ethereum?.request({ method: "eth_chainId" })), 16) || null; } catch { return null; }
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
    setState((s) => ({ ...s, connecting: true, error: null, howto: null }));
    try {
      const chainId = await walletChainId();
      const vault = new MetaMaskVault(chainId ?? loadConfig().chainId);
      const address = await vault.getAddress();
      setState({ signer: vault, address, signerType: "metamask", connecting: false, error: null, howto: null, chainId, walletAvailable: detectWallet() });
      vault.onAccountChange((newAddr) => setState((s) => ({ ...s, address: newAddr })));
    } catch (err: unknown) {
      setState((s) => ({ ...s, connecting: false, error: (err as Error).message }));
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

  // Network switches: rebuild the wallet-backed signer on the new chain instead of disconnecting.
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    const onChain = async (hex: unknown) => {
      const chainId = parseInt(String(hex), 16);
      const cred: YubiKeyCredential | null = JSON.parse(localStorage.getItem(YUBIKEY_KEY) ?? "null");
      setState((s) => {
        if (s.signerType === "metamask") {
          s.signer?.dispose();
          const vault = new MetaMaskVault(chainId);
          return { ...s, chainId, signer: vault };
        }
        return { ...s, chainId };
      });
      if (cred) {
        const wallet = await new MetaMaskVault(chainId).getEthersSigner().catch(() => null);
        setState((s) => (s.signerType === "yubikey" && wallet ? { ...s, signer: new YubiKeyVault(cred, wallet) } : s));
      }
    };
    eth.on("chainChanged", onChain);
    return () => eth.removeListener("chainChanged", onChain);
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
      const chainId = await walletChainId();
      const wallet = await new MetaMaskVault(chainId ?? loadConfig().chainId).getEthersSigner();
      const vault = new YubiKeyVault(cred, wallet);
      await vault.prf("vault-web3/connect-check");   // one touch now, so a key that isn't ready fails here with a how-to
      setState({ signer: vault, address: await vault.getAddress(), signerType: "yubikey", connecting: false, error: null, howto: null, chainId, walletAvailable: detectWallet() });
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
