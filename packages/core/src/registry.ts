/**
 * On-chain VaultRegistry interaction layer.
 *
 * Wraps the Diamond proxy contract for:
 *   - Recording secret version CIDs
 *   - Managing access control policies
 *   - Reading audit log events
 *
 * Uses ethers.js v6 with a Trezor-backed signer.
 */

import { ethers, type ContractTransactionReceipt } from "ethers";
import type { SecretPath, SecretVersionEntry, PolicyEntry, Role } from "./types.js";

// Minimal ABI covering the facets we interact with
const VAULT_REGISTRY_ABI = [
  // VaultRegistryFacet — version is computed internally, no version param
  "function recordSecretVersion(string path, string cid, bytes32 plaintextHash) external returns (uint256 newVersion)",
  // SecretVersion struct fields: version, cid, plaintextHash, timestamp, author, exists (no path field)
  "function getSecretVersion(string path, uint256 version) external view returns (tuple(uint256 version, string cid, bytes32 plaintextHash, uint256 timestamp, address author, bool exists))",
  "function getLatestVersion(string path) external view returns (uint256)",
  "function getVersionHistory(string path) external view returns (tuple(uint256 version, string cid, bytes32 plaintextHash, uint256 timestamp, address author, bool exists)[])",

  // AccessControlFacet
  "function grantRole(string path, address grantee, uint8 role, uint256 expiresAt, bool multiSigRequired) external",
  "function revokeRole(string path, address grantee) external",
  "function hasRole(string path, address account, uint8 role) external view returns (bool)",
  // PolicyEntry struct fields: role, grantee, expiresAt, multiSigRequired, exists (no path field)
  "function getPolicy(string path, address account) external view returns (tuple(uint8 role, address grantee, uint256 expiresAt, bool multiSigRequired, bool exists))",

  // AuditFacet — no fromBlock param; AuditEntry: accessor, operation, granted, timestamp (no path field)
  "function getAuditLog(string path) external view returns (tuple(address accessor, uint8 operation, bool granted, uint256 timestamp)[])",

  // Events — Solidity emits pathIndexed + path (two args for indexed string)
  "event SecretVersionRecorded(string indexed pathIndexed, string path, uint256 version, string cid, address author, uint256 timestamp)",
  "event RoleGranted(string indexed pathIndexed, string path, address indexed grantee, uint8 role, uint256 expiresAt)",
  "event RoleRevoked(string indexed pathIndexed, string path, address indexed grantee)",
  "event AccessAttempt(string indexed pathIndexed, string path, address indexed accessor, uint8 operation, bool granted)",
];

export const ROLE_CODES: Record<Role, number> = {
  owner: 0,
  admin: 1,
  writer: 2,
  reader: 3,
};

export const ROLE_NAMES: Record<number, Role> = {
  0: "owner",
  1: "admin",
  2: "writer",
  3: "reader",
};

export class VaultRegistry {
  private contract: ethers.Contract;

  constructor(
    address: string,
    private readonly provider: ethers.Provider,
    private readonly signer?: ethers.Signer
  ) {
    const connectTo = signer ?? provider;
    this.contract = new ethers.Contract(address, VAULT_REGISTRY_ABI, connectTo);
  }

  // ─── Secret Versioning ─────────────────────────────────────────────────────

  /**
   * Record a new secret version on-chain.
   * Emits SecretVersionRecorded — permanently auditable.
   */
  async recordVersion(
    path: SecretPath,
    cid: string,
    plaintextHash: string
  ): Promise<ContractTransactionReceipt> {
    const plaintextHashBytes32 = ethers.zeroPadValue(
      ethers.toBeHex(ethers.keccak256(ethers.toUtf8Bytes(plaintextHash))),
      32
    );

    const tx = await this.contract.recordSecretVersion(path, cid, plaintextHashBytes32);
    const receipt = await tx.wait(1); // wait for 1 confirmation
    if (!receipt) throw new Error("Transaction receipt not received");
    return receipt;
  }

  async getLatestVersion(path: SecretPath): Promise<bigint> {
    return this.contract.getLatestVersion(path);
  }

  async getVersionEntry(
    path: SecretPath,
    version: number
  ): Promise<SecretVersionEntry> {
    const entry = await this.contract.getSecretVersion(path, version);
    return {
      path,
      version: Number(entry.version),
      cid: entry.cid,
      plaintextHash: entry.plaintextHash,
      timestamp: Number(entry.timestamp),
      author: entry.author,
    };
  }

  async getVersionHistory(path: SecretPath): Promise<SecretVersionEntry[]> {
    const entries = await this.contract.getVersionHistory(path);
    return entries.map((e: any) => ({
      path,
      version: Number(e.version),
      cid: e.cid,
      plaintextHash: e.plaintextHash,
      timestamp: Number(e.timestamp),
      author: e.author,
    }));
  }

  // ─── Access Control ────────────────────────────────────────────────────────

  async grantRole(
    path: SecretPath,
    grantee: string,
    role: Role,
    expiresAt = 0,
    multiSigRequired = false
  ): Promise<ContractTransactionReceipt> {
    const tx = await this.contract.grantRole(
      path,
      grantee,
      ROLE_CODES[role],
      expiresAt,
      multiSigRequired
    );
    const receipt = await tx.wait(1);
    if (!receipt) throw new Error("Transaction receipt not received");
    return receipt;
  }

  async revokeRole(
    path: SecretPath,
    grantee: string
  ): Promise<ContractTransactionReceipt> {
    const tx = await this.contract.revokeRole(path, grantee);
    const receipt = await tx.wait(1);
    if (!receipt) throw new Error("Transaction receipt not received");
    return receipt;
  }

  async hasRole(
    path: SecretPath,
    account: string,
    role: Role
  ): Promise<boolean> {
    return this.contract.hasRole(path, account, ROLE_CODES[role]);
  }

  async getPolicy(
    path: SecretPath,
    account: string
  ): Promise<PolicyEntry | null> {
    try {
      const p = await this.contract.getPolicy(path, account);
      if (!p.exists) return null;
      return {
        path,
        role: ROLE_NAMES[Number(p.role)],
        grantee: p.grantee,
        expiresAt: Number(p.expiresAt),
        multiSigRequired: p.multiSigRequired,
      };
    } catch {
      return null;
    }
  }

  // ─── Audit Log ─────────────────────────────────────────────────────────────

  async getAuditLog(
    path: SecretPath,
    fromBlock = 0
  ): Promise<Array<{
    accessor: string;
    path: string;
    operation: string;
    granted: boolean;
    timestamp: number;
  }>> {
    const entries = await this.contract.getAuditLog(path);
    const OPS = ["read", "write", "delete", "rotate"];
    return entries.map((e: any) => ({
      accessor: e.accessor,
      path,
      operation: OPS[Number(e.operation)] ?? "unknown",
      granted: e.granted,
      timestamp: Number(e.timestamp),
    }));
  }

  // ─── Event Listeners ───────────────────────────────────────────────────────

  onSecretVersionRecorded(
    path: SecretPath,
    callback: (version: number, cid: string, author: string) => void
  ): () => void {
    const filter = this.contract.filters.SecretVersionRecorded(path);
    const listener = (
      _path: string,
      version: bigint,
      cid: string,
      author: string
    ) => callback(Number(version), cid, author);
    this.contract.on(filter, listener);
    return () => { this.contract.off(filter, listener); };
  }
}

// ─── Trezor-backed ethers Signer ─────────────────────────────────────────────

/**
 * An ethers.js v6 Signer that delegates transaction signing to Trezor.
 * Used to send on-chain transactions (recordVersion, grantRole, etc.) with
 * physical Trezor confirmation for every state-changing operation.
 */
import TrezorConnectModule from "@trezor/connect";
const TrezorConnect = (TrezorConnectModule as any).default || TrezorConnectModule as any;

export class TrezorSigner extends ethers.AbstractSigner {
  constructor(
    provider: ethers.Provider,
    private readonly address: string,
    private readonly derivationPath: string,
    private readonly chainId: bigint
  ) {
    super(provider);
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  async signTransaction(tx: ethers.TransactionRequest): Promise<string> {
    const populated = await this.populateTransaction(tx);
    const serialized = ethers.Transaction.from(populated);

    const result = await TrezorConnect.ethereumSignTransaction({
      path: this.derivationPath,
      transaction: {
        to: populated.to as string,
        value: ethers.toBeHex(populated.value ?? 0n),
        gasPrice: populated.gasPrice
          ? ethers.toBeHex(populated.gasPrice as bigint)
          : undefined,
        maxFeePerGas: populated.maxFeePerGas
          ? ethers.toBeHex(populated.maxFeePerGas as bigint)
          : undefined,
        maxPriorityFeePerGas: populated.maxPriorityFeePerGas
          ? ethers.toBeHex(populated.maxPriorityFeePerGas as bigint)
          : undefined,
        gasLimit: ethers.toBeHex(populated.gasLimit ?? 21000n),
        nonce: ethers.toBeHex(populated.nonce ?? 0),
        data: (populated.data as string) ?? "0x",
        chainId: Number(this.chainId),
      } as any,
    });

    if (!result.success) {
      throw new Error(`Trezor transaction signing failed: ${result.payload.error}`);
    }

    const { v, r, s } = result.payload;
    serialized.signature = ethers.Signature.from({ v: Number(v), r, s });
    return serialized.serialized;
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    const msg =
      typeof message === "string" ? message : Buffer.from(message).toString("hex");
    const result = await TrezorConnect.ethereumSignMessage({
      path: this.derivationPath,
      message: msg,
      hex: typeof message !== "string",
    });
    if (!result.success) {
      throw new Error(`Trezor message signing failed: ${result.payload.error}`);
    }
    return result.payload.signature;
  }

  async signTypedData(
    _domain: ethers.TypedDataDomain,
    _types: Record<string, ethers.TypedDataField[]>,
    _value: Record<string, unknown>
  ): Promise<string> {
    throw new Error(
      "Use TrezorVault.signTypedData for EIP-712 signing — do not call this method directly."
    );
  }

  connect(provider: ethers.Provider): TrezorSigner {
    return new TrezorSigner(provider, this.address, this.derivationPath, this.chainId);
  }
}
