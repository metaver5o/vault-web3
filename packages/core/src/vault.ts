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
import { IPFSClient } from "./ipfs.js";
import { VaultRegistry } from "./registry.js";

const RECORDED = new ethers.Interface([
  "event SecretVersionRecorded(string indexed pathIndexed, string path, uint256 version, string cid, address author, uint256 timestamp)",
]);

export class VaultClient {
  private signer: VaultSigner;
  private ipfs: IPFSClient;
  private registry: VaultRegistry;
  private provider: ethers.JsonRpcProvider;
  private config: VaultConfig;
  /** Latest version this client wrote per path, so reads can wait for a lagging RPC node. */
  private written = new Map<string, number>();

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
    const { path, data, derivationIndex = 0 } = req;

    // Step 1: Derive KEK — requires signer confirmation (Trezor button / MetaMask popup)
    const derivedKeys = await this.signer.deriveKEK(path, derivationIndex);
    const derivationPath = `m/44'/60'/${this.config.accountIndex}'/0/0`;

    // Step 2: Encrypt
    const envelope = await encryptSecret(
      data, derivedKeys, derivationPath, this.config.chainId
    );
    // Zero sensitive material
    derivedKeys.kekRaw.fill(0);

    // Step 3: Store on IPFS
    const pinResult = await this.ipfs.storeEnvelope(envelope);

    // Step 4: Record on-chain — requires second signer confirmation
    const signedRegistry = await this.getSignedRegistry();
    const receipt = await signedRegistry.recordVersion(
      path,
      pinResult.cid,
      envelope.plaintextHash
    );

    // Take the version from the receipt: a fresh read can hit an RPC node that is a block behind.
    const event = receipt.logs
      .map((log) => { try { return RECORDED.parseLog(log); } catch { return null; } })
      .find((e) => e?.name === "SecretVersionRecorded");
    const version = event ? Number(event.args.version) : Number(await this.registry.getLatestVersion(path));
    this.written.set(path, Math.max(version, this.written.get(path) ?? 0));
    return {
      path,
      version,
      cid: pinResult.cid,
      txHash: receipt.hash,
      timestamp: Date.now(),
    };
  }

  // ─── Read ───────────────────────────────────────────────────────────────────

  /**
   * Latest version on-chain. Public RPCs balance across nodes that can lag a block
   * or two, so if this client just wrote a newer version, wait for the node to catch up.
   */
  private async latestVersion(path: SecretPath): Promise<number> {
    const expected = this.written.get(path) ?? 0;
    let latest = Number(await this.registry.getLatestVersion(path));
    for (let i = 0; latest < expected && i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      latest = Number(await this.registry.getLatestVersion(path));
    }
    return latest;
  }

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
      const latestVersion = await this.latestVersion(path);
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
    await this.latestVersion(path);   // wait until the node has this client's own writes
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
}
