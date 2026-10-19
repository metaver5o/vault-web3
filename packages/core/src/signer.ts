/**
 * VaultSigner — common interface for all signing backends.
 *
 * Implemented by:
 *   - TrezorVault  (hardware wallet, CLI + browser)
 *   - MetaMaskVault (browser extension, browser only)
 *
 * The interface is intentionally minimal: derive a KEK and provide an
 * ethers.js Signer for on-chain transactions. Everything else is internal.
 */

import type { ethers } from "ethers";
import type { DerivedKeys, ThresholdShare, TrezorSignResult } from "./types.js";

export interface VaultSigner {
  /** Return the Ethereum address controlled by this signer. */
  getAddress(): Promise<string>;

  /**
   * Derive a KEK for the given namespace.
   * Implementations must require explicit user confirmation (physical button
   * press for Trezor, MetaMask popup for MetaMask).
   */
  deriveKEK(namespace: string, derivationIndex?: number): Promise<DerivedKeys>;

  /**
   * Collect a threshold share (for multi-sig unsealing).
   * Returns the raw signature that will be XOR-combined with other shares.
   */
  collectThresholdShare(namespace: string, derivationIndex?: number): Promise<ThresholdShare>;

  /**
   * Return an ethers.js Signer for submitting on-chain transactions.
   * The provider parameter is used by Trezor (which needs an external RPC);
   * MetaMask provides its own provider via window.ethereum.
   */
  getEthersSigner(provider?: ethers.Provider): Promise<ethers.Signer>;

  /** Signer type identifier — used for UI labeling and config serialization. */
  readonly signerType: "trezor" | "metamask";

  /** Release resources (TrezorConnect.dispose, etc). No-op for MetaMask. */
  dispose(): void;
}
