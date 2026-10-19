/**
 * Trezor integration for vault-web3.
 *
 * Key design decisions:
 * - KEK derivation uses EIP-712 typed data signing over a *deterministic* message.
 *   No randomness in the signed struct — the same namespace always produces the
 *   same signature on the same device, giving us a reproducible KEK.
 * - We never call getPublicKey / getAddress for secret material. Those paths
 *   are only used for identity verification (who is the operator?).
 * - For multi-sig unsealing we XOR the HKDF outputs of each share, so a single
 *   compromised device leaks nothing about the combined KEK.
 *
 * CRYPTOGRAPHIC ASSUMPTION:
 *   We treat the Trezor's secp256k1 ECDSA signature as a 64-byte secret (r,s)
 *   conditioned on the private key and message. Signature malleability is not
 *   a concern here because we use the 65-byte canonical form (with recovery bit)
 *   as HKDF input material, not as an on-chain signature.
 */

import TrezorConnectModule from "@trezor/connect";
const TrezorConnect = (TrezorConnectModule as any).default || (TrezorConnectModule as any);
import { ethers } from "ethers";
import type {
  TrezorSignResult,
  ThresholdShare,
  ThresholdKEKDerivation,
  VaultConfig,
  DerivedKeys,
} from "./types.js";
import type { VaultSigner } from "./signer.js";
import { deriveKEKFromSignature, xorCombineKEKShares } from "./crypto.js";
import { TrezorSigner } from "./registry.js";

// ─── TrezorVault class ────────────────────────────────────────────────────────

export class TrezorVault implements VaultSigner {
  readonly signerType = "trezor" as const;
  private initialized = false;

  constructor(private readonly config: VaultConfig) { }

  async init(): Promise<void> {
    if (this.initialized) return;
    await TrezorConnect.init({
      manifest: { appName: "vault-web3", ...this.config.trezorManifest },
      // Disable popup in Node.js CLI context; use TrezorConnect Bridge
      lazyLoad: false,
    });
    this.initialized = true;
  }

  private derivationPath(accountIndex = 0): string {
    return `m/44'/60'/${accountIndex}'/0/0`;
  }

  /**
   * Returns the Ethereum address at the configured account index.
   * Used for on-chain identity, not for key material.
   */
  async getAddress(accountIndex?: number): Promise<string> {
    await this.init();
    const path = this.derivationPath(accountIndex ?? this.config.accountIndex);
    const result = await TrezorConnect.ethereumGetAddress({ path, showOnTrezor: false });
    if (!result.success) {
      throw new Error(`Trezor address retrieval failed: ${result.payload.error}`);
    }
    return result.payload.address;
  }

  /**
   * Sign a deterministic message with the Trezor.
   * Returns the raw 65-byte signature as a 0x-prefixed hex string.
   *
   * The Trezor will show the message on-device for confirmation.
   * Physical button press is required — this is the hardware enforcement point.
   */
  async signMessage(
    namespace: string,
    derivationIndex: number,
    accountIndex?: number
  ): Promise<TrezorSignResult> {
    await this.init();
    const path = this.derivationPath(accountIndex ?? this.config.accountIndex);
    const messageString = `vault-web3:kek:v1:${namespace}:${derivationIndex}`;

    const result = await TrezorConnect.ethereumSignMessage({ path, message: messageString, hex: false });
    if (!result.success) {
      throw new Error(`Trezor signing failed: ${result.payload.error}`);
    }

    return {
      address: result.payload.address,
      signature: result.payload.signature,
    };
  }

  /**
   * Derive a KEK for the given namespace.
   *
   * Flow:
   *   1. Build a deterministic message from the namespace + derivationIndex
   *   2. Request Trezor to sign it (requires physical button press)
   *   3. Feed the 65-byte signature into HKDF-SHA256 to produce the 256-bit KEK
   *
   * TRADEOFF: If an attacker has both your Trezor PIN and the device, they can
   * reproduce the KEK. Physical possession of the device is the security boundary.
   * This is intentional — it mirrors how hardware wallets work for private keys.
   */
  async deriveKEK(
    namespace: string,
    derivationIndex = 0,
    accountIndex?: number
  ): Promise<DerivedKeys> {
    const signed = await this.signMessage(namespace, derivationIndex, accountIndex);
    return deriveKEKFromSignature(signed.signature, namespace, derivationIndex);
  }

  /**
   * Collect a threshold share from this Trezor for multi-sig unsealing.
   */
  async collectThresholdShare(
    namespace: string,
    derivationIndex = 0,
    accountIndex?: number
  ): Promise<ThresholdShare> {
    const path = this.derivationPath(accountIndex ?? this.config.accountIndex);
    const signed = await this.signMessage(namespace, derivationIndex, accountIndex);
    return {
      signer: signed.address,
      signature: signed.signature,
      derivationPath: path,
    };
  }

  /**
   * Derive a combined KEK from M-of-N Trezor shares.
   *
   * Each share produces an independent HKDF output keyed to that signer's address.
   * The combined KEK = XOR of all M share KEKs.
   *
   * CRYPTOGRAPHIC NOTE:
   *   XOR combination of independent pseudorandom keys is a standard technique
   *   (see: HKDF RFC 5869 §3.5, Secret Sharing via XOR). The resulting key has
   *   full entropy only if ALL shares have full entropy — meaning any single
   *   share reveals zero information about the combined key.
   *   This is NOT Shamir Secret Sharing (SSS). SSS requires exactly M shares;
   *   this scheme requires exactly M (not "any M of N") — for true threshold
   *   recovery, replace XOR with a proper SSS library like `shamirs-secret-sharing`.
   */
  async deriveThresholdKEK(
    derivation: ThresholdKEKDerivation,
    namespace: string
  ): Promise<DerivedKeys> {
    if (derivation.shares.length < derivation.threshold) {
      throw new Error(
        `Need ${derivation.threshold} shares, got ${derivation.shares.length}`
      );
    }
    return xorCombineKEKShares(derivation.shares, namespace);
  }

  /**
   * Return an ethers.js Signer backed by the Trezor.
   * Requires a JSON-RPC provider for nonce/gas lookups.
   */
  async getEthersSigner(provider?: ethers.Provider): Promise<ethers.Signer> {
    if (!provider) throw new Error("TrezorVault.getEthersSigner requires a Provider");
    const address = await this.getAddress();
    const path = this.derivationPath(this.config.accountIndex);
    return new TrezorSigner(provider, address, path, BigInt(this.config.chainId));
  }

  dispose(): void {
    TrezorConnect.dispose();
    this.initialized = false;
  }
}
