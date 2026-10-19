/**
 * MetaMask signing backend for vault-web3.
 *
 * Works in any EIP-1193 browser environment (MetaMask, Rabby, Coinbase Wallet, etc).
 * Uses the same KEK derivation scheme as Trezor — HKDF-SHA256 over the EIP-712
 * signature — so encrypted envelopes are backend-agnostic. A secret written with
 * Trezor can be read with MetaMask if both control the same Ethereum private key.
 *
 * SECURITY NOTE vs Trezor:
 *   - MetaMask stores the private key in the browser extension's encrypted storage.
 *     The key is accessible to the browser process; a compromised extension or browser
 *     could exfiltrate it. Trezor keeps the key in firmware on an isolated MCU.
 *   - MetaMask's EIP-712 signing happens in software; Trezor's in hardware.
 *   - For high-security secrets, use Trezor. MetaMask is appropriate for development,
 *     team-shared read-only access, or low-sensitivity secrets.
 *
 * BROWSER ONLY: window.ethereum is not available in Node.js.
 * For CLI use, stick with TrezorVault.
 */

import { ethers } from "ethers";
import type { VaultSigner } from "./signer.js";
import type { DerivedKeys, ThresholdShare, VaultAuthMessage } from "./types.js";
import { deriveKEKFromSignature } from "./crypto.js";

// EIP-712 domain + types — identical to Trezor's to ensure cross-backend compatibility
const EIP712_DOMAIN = {
  name: "Web3Vault",
  version: "1",
};

const EIP712_TYPES = {
  VaultAuth: [
    { name: "namespace", type: "string" },
    { name: "purpose", type: "string" },
    { name: "version", type: "uint256" },
    { name: "derivationIndex", type: "uint256" },
  ],
};

// EIP-1193 provider shape (MetaMask / any injected wallet)
interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export class MetaMaskVault implements VaultSigner {
  readonly signerType = "metamask" as const;

  private provider: ethers.BrowserProvider | null = null;
  private chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  private getWindowEthereum(): EIP1193Provider {
    if (typeof window === "undefined" || !window.ethereum) {
      throw new Error(
        "MetaMask (or compatible EIP-1193 wallet) not found. " +
        "Install MetaMask or use TrezorVault for CLI environments."
      );
    }
    return window.ethereum;
  }

  private async getProvider(): Promise<ethers.BrowserProvider> {
    if (!this.provider) {
      this.provider = new ethers.BrowserProvider(this.getWindowEthereum() as any);
    }
    return this.provider;
  }

  /**
   * Request wallet connection and return the primary account address.
   * Triggers the MetaMask "connect" popup on first call.
   */
  async getAddress(): Promise<string> {
    const provider = await this.getProvider();
    const signer = await provider.getSigner();
    return signer.getAddress();
  }

  /**
   * Sign the EIP-712 VaultAuth message via MetaMask.
   * Triggers a MetaMask popup showing the typed data fields.
   * User must click "Sign" — this is the software-enforced auth gate.
   */
  private async signTypedData(msg: VaultAuthMessage): Promise<string> {
    const provider = await this.getProvider();
    const signer = await provider.getSigner();

    // Use the wallet's ACTIVE chain — NOT the config chainId.
    // MetaMask (and all EIP-1193 wallets) reject eth_signTypedData_v4 if the
    // domain.chainId doesn't match the currently selected network.
    //
    // NOTE: ethers v6 BrowserProvider.getNetwork() caches the chain ID from the
    // first call and does not refresh it automatically. We must query eth_chainId
    // directly via the EIP-1193 provider to always get the real current chain,
    // otherwise a stale cached value causes MetaMask to reject with:
    //   "Provided chainId X must match the active chainId Y"
    const chainIdHex = await this.getWindowEthereum().request({ method: "eth_chainId" }) as string;
    const activeChainId = parseInt(chainIdHex, 16);

    // ethers v6 signTypedData handles eth_signTypedData_v4 internally
    const signature = await signer.signTypedData(
      { ...EIP712_DOMAIN, chainId: activeChainId },
      EIP712_TYPES,
      {
        namespace: msg.namespace,
        purpose: msg.purpose,
        version: msg.version,
        derivationIndex: msg.derivationIndex,
      }
    );
    return signature; // 0x-prefixed 65-byte hex
  }

  /**
   * Derive a KEK for the given namespace.
   * Identical HKDF derivation to TrezorVault — envelopes are interoperable.
   */
  async deriveKEK(namespace: string, derivationIndex = 0): Promise<DerivedKeys> {
    const msg: VaultAuthMessage = {
      namespace,
      purpose: "kek-derivation",
      version: 1,
      derivationIndex,
    };
    const signature = await this.signTypedData(msg);
    return deriveKEKFromSignature(signature, namespace, derivationIndex);
  }

  async collectThresholdShare(namespace: string, derivationIndex = 0): Promise<ThresholdShare> {
    const msg: VaultAuthMessage = {
      namespace,
      purpose: "kek-derivation",
      version: 1,
      derivationIndex,
    };
    const signature = await this.signTypedData(msg);
    const address = await this.getAddress();
    return {
      signer: address,
      signature,
      derivationPath: "metamask:0", // MetaMask doesn't expose BIP44 paths
    };
  }

  /**
   * Return an ethers.js Signer backed by MetaMask.
   * The provider argument is ignored — MetaMask provides its own RPC.
   */
  async getEthersSigner(_provider?: ethers.Provider): Promise<ethers.Signer> {
    const provider = await this.getProvider();
    return provider.getSigner();
  }

  /**
   * Listen for account or chain changes and invoke the callback.
   * Use this in the UI to react to MetaMask account switches.
   */
  onAccountChange(cb: (address: string) => void): () => void {
    const ethereum = this.getWindowEthereum();
    const handler = (accounts: unknown) => {
      const list = accounts as string[];
      if (list.length > 0) cb(list[0]);
    };
    ethereum.on("accountsChanged", handler);
    return () => ethereum.removeListener("accountsChanged", handler);
  }

  onChainChange(cb: (chainId: number) => void): () => void {
    const ethereum = this.getWindowEthereum();
    const handler = (chainIdHex: unknown) => {
      cb(parseInt(chainIdHex as string, 16));
    };
    ethereum.on("chainChanged", handler);
    return () => ethereum.removeListener("chainChanged", handler);
  }

  /**
   * Switch MetaMask to a specific chain. Prompts the user if not already on it.
   */
  async switchChain(chainId: number): Promise<void> {
    const ethereum = this.getWindowEthereum();
    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });
    } catch (err: any) {
      // Error 4902 = chain not added to MetaMask
      if (err.code === 4902) {
        throw new Error(
          `Chain ${chainId} not configured in MetaMask. Add it manually or call wallet_addEthereumChain.`
        );
      }
      throw err;
    }
  }

  dispose(): void {
    this.provider = null;
  }
}

/**
 * Detect if a wallet is available in the current browser context.
 */
export function detectWallet(): "metamask" | "other-eip1193" | "none" {
  if (typeof window === "undefined" || !window.ethereum) return "none";
  // MetaMask sets isMetaMask; other wallets may not
  if ((window.ethereum as any).isMetaMask) return "metamask";
  return "other-eip1193";
}
