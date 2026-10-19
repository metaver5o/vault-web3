/**
 * VaultClient — the main entry point for all vault operations.
 *
 * Orchestrates: Trezor → Crypto → IPFS → Registry
 *
 * This is the facade used by both the CLI and the REST API.
 */

import { ethers } from "ethers";
import type {
  SecretPath,
  WriteSecretRequest,
  ReadSecretResponse,
  SecretVersionEntry,
  PolicyEntry,
  Role,
  VaultConfig,
  ThresholdConfig,
  ThresholdShare,
} from "./types.js";
import type { VaultSigner } from "./signer.js";
import { TrezorVault } from "./trezor.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import { fetchQuantumEntropy } from "./qshaas.js";
import { IPFSClient } from "./ipfs.js";
import { VaultRegistry } from "./registry.js";

export class VaultClient {
  private signer: VaultSigner;
  private ipfs: IPFSClient;
  private registry: VaultRegistry;
  private provider: ethers.JsonRpcProvider;
  private config: VaultConfig;

  /**
   * @param config    Vault configuration
   * @param signer    Signing backend — TrezorVault or MetaMaskVault.
   *                  Defaults to TrezorVault if omitted (backwards-compatible).
   */
  constructor(config: VaultConfig, signer?: VaultSigner) {
    this.config = config;
    const addr = config.registryAddress;
    if (!addr || addr === "0x0000000000000000000000000000000000000000") {
      throw new Error(
        "Registry contract address is not configured. " +
        "Go to Settings → Registry Address and paste the deployed contract address."
      );
    }
    this.signer = signer ?? new TrezorVault(config);
    this.ipfs = new IPFSClient(config.ipfsApiUrl);
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.registry = new VaultRegistry(addr, this.provider);
  }

  private async getSignedRegistry(): Promise<VaultRegistry> {
    const ethersSigner = await this.signer.getEthersSigner(this.provider);
    return new VaultRegistry(this.config.registryAddress, this.provider, ethersSigner);
  }

  // ─── Write ──────────────────────────────────────────────────────────────────

  /**
   * Encrypt and store a secret.
   *
   * Flow:
   *   1. Derive KEK from Trezor (physical button press required)
   *   2. Encrypt payload: DEK wrapped by KEK, data encrypted by DEK
   *   3. Pin envelope to IPFS, get CID
   *   4. Record CID + version on-chain (second Trezor confirmation for tx signing)
   */
  async write(req: WriteSecretRequest): Promise<SecretMetadataResult> {
    const { path, data, derivationIndex = 0, useQuantumSeed, qshaasApiKey, qshaasApiUrl } = req;

    // Step 1: Optionally fetch quantum entropy (non-blocking — failure falls back to CSPRNG)
    let quantumEntropy: Uint8Array | undefined;
    let quantumJobId: string | undefined;
    if (useQuantumSeed && qshaasApiKey) {
      const qe = await fetchQuantumEntropy({
        apiUrl: qshaasApiUrl ?? "https://api.criptografia.net",
        apiKey: qshaasApiKey,
      });
      if (qe) {
        quantumEntropy = qe.bytes;
        quantumJobId = qe.jobId;
      }
    }

    // Step 2: Derive KEK — requires signer confirmation (Trezor button / MetaMask popup)
    const derivedKeys = await this.signer.deriveKEK(path, derivationIndex);
    const derivationPath = `m/44'/60'/${this.config.accountIndex}'/0/0`;

    // Step 3: Encrypt (with optional quantum DEK mixing)
    const envelope = await encryptSecret(
      data, derivedKeys, derivationPath, this.config.chainId, quantumEntropy, path
    );
    // Zero sensitive material
    derivedKeys.kekRaw.fill(0);
    if (quantumEntropy) quantumEntropy.fill(0);

    // Step 4: Store on IPFS
    const pinResult = await this.ipfs.storeEnvelope(envelope);

    // Step 5: Record on-chain — requires second signer confirmation
    const signedRegistry = await this.getSignedRegistry();
    const receipt = await signedRegistry.recordVersion(
      path,
      pinResult.cid,
      envelope.plaintextHash
    );

    const version = Number(await this.registry.getLatestVersion(path));
    return {
      path,
      version,
      cid: pinResult.cid,
      txHash: receipt.hash,
      timestamp: Date.now(),
      quantumJobId,
    };
  }

  // ─── Read ───────────────────────────────────────────────────────────────────

  /**
   * Read and decrypt a secret.
   *
   * Flow:
   *   1. Fetch latest version CID from on-chain registry
   *   2. Fetch encrypted envelope from IPFS by CID
   *   3. Derive KEK from Trezor (physical button press required)
   *   4. Decrypt envelope, verify integrity
   */
  async read(path: SecretPath, version?: number): Promise<ReadSecretResponse> {
    // Step 1: Get CID from registry
    let versionEntry: SecretVersionEntry;
    if (version !== undefined) {
      versionEntry = await this.registry.getVersionEntry(path, version);
    } else {
      const latestVersion = Number(await this.registry.getLatestVersion(path));
      if (latestVersion === 0) {
        throw new Error(`Secret not found: ${path}`);
      }
      versionEntry = await this.registry.getVersionEntry(path, latestVersion);
    }

    // Step 2: Fetch from IPFS
    const envelope = await this.ipfs.fetchEnvelope(versionEntry.cid);

    // Step 3: Derive KEK — requires signer confirmation (Trezor button / MetaMask popup)
    const derivedKeys = await this.signer.deriveKEK(path, 0);

    // Step 4: Decrypt
    const plaintext = await decryptSecret(envelope, derivedKeys);
    derivedKeys.kekRaw.fill(0);

    return {
      data: plaintext,
      metadata: {
        path,
        engine: "kv",
        version: versionEntry.version,
        cid: versionEntry.cid,
        createdAt: versionEntry.timestamp * 1000,
        updatedAt: versionEntry.timestamp * 1000,
        plaintextHash: envelope.plaintextHash,
        onChainTxHash: undefined,
      },
    };
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────

  /**
   * Soft-delete: records a tombstone version with empty data.
   * On-chain history is immutable — prior versions remain accessible.
   */
  async delete(path: SecretPath): Promise<void> {
    await this.write({ path, data: { _deleted: "true", _deletedAt: String(Date.now()) } });
  }

  // ─── Version History ────────────────────────────────────────────────────────

  async listVersions(path: SecretPath): Promise<SecretVersionEntry[]> {
    return this.registry.getVersionHistory(path);
  }

  // ─── Access Control ─────────────────────────────────────────────────────────

  async grantRole(
    path: SecretPath,
    grantee: string,
    role: Role,
    opts: { expiresAt?: number; multiSigRequired?: boolean } = {}
  ): Promise<string> {
    const signedRegistry = await this.getSignedRegistry();
    const receipt = await signedRegistry.grantRole(
      path,
      grantee,
      role,
      opts.expiresAt ?? 0,
      opts.multiSigRequired ?? false
    );
    return receipt.hash;
  }

  async revokeRole(path: SecretPath, grantee: string): Promise<string> {
    const signedRegistry = await this.getSignedRegistry();
    const receipt = await signedRegistry.revokeRole(path, grantee);
    return receipt.hash;
  }

  async checkAccess(path: SecretPath, account: string, role: Role): Promise<boolean> {
    return this.registry.hasRole(path, account, role);
  }

  async getPolicy(path: SecretPath, account: string): Promise<PolicyEntry | null> {
    return this.registry.getPolicy(path, account);
  }

  // ─── Audit ──────────────────────────────────────────────────────────────────

  async getAuditLog(path: SecretPath, fromBlock = 0) {
    return this.registry.getAuditLog(path, fromBlock);
  }

  // ─── Health ─────────────────────────────────────────────────────────────────

  async healthCheck(): Promise<{
    ipfs: { id: string; version: string };
    chain: { blockNumber: number; chainId: number };
    signer: { type: string; address: string };
  }> {
    const [ipfsInfo, blockNumber, address] = await Promise.all([
      this.ipfs.healthCheck(),
      this.provider.getBlockNumber(),
      this.signer.getAddress(),
    ]);
    return {
      ipfs: ipfsInfo,
      chain: { blockNumber, chainId: this.config.chainId },
      signer: { type: this.signer.signerType, address },
    };
  }

  dispose(): void {
    this.signer.dispose();
  }
}

export interface SecretMetadataResult {
  path: string;
  version: number;
  cid: string;
  txHash: string;
  timestamp: number;
  quantumJobId?: string;
}
