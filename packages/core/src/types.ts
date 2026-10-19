// ─── Domain Types ────────────────────────────────────────────────────────────

/**
 * A secret path uses the same slash-delimited namespace as HashiCorp Vault:
 *   "secret/myapp/db"
 *   "ssh/prod-bastion"
 *   "pki/root/ca"
 */
export type SecretPath = string;

/** Secret engine types, analogous to Vault secret engines */
export type EngineType = "kv" | "ssh" | "pki" | "apikey";

export interface SecretMetadata {
  path: SecretPath;
  engine: EngineType;
  version: number;
  /** IPFS CID of the encrypted payload for this version */
  cid: string;
  createdAt: number;
  updatedAt: number;
  /** Keccak256 of the plaintext — used to detect tampering post-decryption */
  plaintextHash: string;
  /** On-chain tx hash that recorded this version */
  onChainTxHash?: string;
}

export interface SecretPayload {
  /** Arbitrary key→value pairs (KV engine) */
  data: Record<string, string>;
  metadata: Omit<SecretMetadata, "plaintextHash">;
}

// ─── Envelope Encryption ─────────────────────────────────────────────────────

/**
 * Envelope encryption blob stored on IPFS.
 *
 * Layout:
 *   encryptedDEK  = AES-256-GCM(KEK, DEK)           — KEK is Trezor-derived
 *   encryptedData = AES-256-GCM(DEK, plaintext)       — DEK is random
 *   plaintextHash = HMAC-SHA256(HKDF(KEK), plaintext)  — only the KEK holder can check it
 *
 * Neither the KEK nor the DEK ever appear in plaintext outside of the device.
 */
export interface EncryptedEnvelope {
  version: 1 | 2;   // 2: keyed integrity tag (HMAC), 1: plain SHA-256
  algorithm: "AES-256-GCM+ChaCha20-Poly1305" | "AES-256-GCM+AES-256-GCM";
  /** Base64url-encoded IV for DEK wrapping (AES-GCM) */
  dekIv: string;
  /** Base64url-encoded AES-GCM tag for DEK wrapping */
  dekTag: string;
  /** Base64url-encoded wrapped (encrypted) DEK */
  encryptedDek: string;
  /** Base64url-encoded nonce for payload encryption (ChaCha20) */
  dataNonce: string;
  /** Base64url-encoded encrypted + authenticated payload */
  encryptedData: string;
  /** Blake3/SHA-256 hash of plaintext for post-decrypt integrity check */
  plaintextHash: string;
  /** BIP44 derivation path used to obtain the signing key for KEK derivation */
  derivationPath: string;
  /** Chain ID used in EIP-712 domain for KEK derivation */
  chainId: number;
}

// ─── Trezor / Key Derivation ─────────────────────────────────────────────────

export interface TrezorSignResult {
  address: string;
  signature: string; // 0x-prefixed hex, 65 bytes
}

/**
 * EIP-712 typed data message used for deterministic KEK derivation.
 * MUST NOT contain any randomness — the signature must be reproducible.
 */
export interface VaultAuthMessage {
  namespace: string;   // e.g. "secret/myapp/db"
  purpose: "kek-derivation";
  version: number;     // protocol version, currently 1
  derivationIndex: number; // allows key rotation without re-encrypting
}

export interface DerivedKeys {
  /** 256-bit Key Encryption Key derived from Trezor signature via HKDF */
  kek: CryptoKey;
  /** Raw bytes of the KEK (kept only in memory, zeroed after use) */
  kekRaw: Uint8Array;
}

// ─── IPFS ────────────────────────────────────────────────────────────────────

export interface IPFSPinResult {
  cid: string;
  size: number;
}

// ─── On-chain Registry ───────────────────────────────────────────────────────

export type Role = "owner" | "admin" | "writer" | "reader";

export interface PolicyEntry {
  path: SecretPath;
  role: Role;
  grantee: string;    // Ethereum address
  expiresAt: number;  // 0 = never
  multiSigRequired: boolean;
}

export interface SecretVersionEntry {
  path: SecretPath;
  version: number;
  cid: string;
  plaintextHash: string;
  timestamp: number;
  author: string; // Ethereum address
}

// ─── CLI / API DTOs ──────────────────────────────────────────────────────────

export interface WriteSecretRequest {
  path: SecretPath;
  data: Record<string, string>;
  /** Optional: force a specific derivation index for the KEK */
  derivationIndex?: number;
  /** Mix quantum entropy from QSHaaS into the DEK generation */
  useQuantumSeed?: boolean;
  /** QSHaaS API key (required when useQuantumSeed=true) */
  qshaasApiKey?: string;
  /** QSHaaS API base URL (defaults to https://api.criptografia.net) */
  qshaasApiUrl?: string;
}

export interface ReadSecretResponse {
  data: Record<string, string>;
  metadata: SecretMetadata;
}

export interface VaultConfig {
  /** Trezor Connect manifest */
  trezorManifest: {
    email: string;
    appUrl: string;
  };
  /** IPFS API endpoint */
  ipfsApiUrl: string;
  /** RPC endpoint for the L2 chain */
  rpcUrl: string;
  /** Diamond proxy address of the VaultRegistry contract */
  registryAddress: string;
  /** EIP-712 chain ID */
  chainId: number;
  /** Default BIP44 account index */
  accountIndex: number;
}

// ─── Multi-sig Unsealing ─────────────────────────────────────────────────────

export interface ThresholdConfig {
  /** Minimum number of Trezor devices required to unseal */
  threshold: number;
  /** All eligible signer addresses */
  signers: string[];
}

export interface ThresholdShare {
  /** Ethereum address of the signing Trezor */
  signer: string;
  /** The EIP-712 signature from this device */
  signature: string;
  /** Derivation path used */
  derivationPath: string;
}

/**
 * For M-of-N threshold unsealing:
 * The KEK is derived from the XOR of M Trezor signatures, each hashed via HKDF.
 * This ensures that any single compromised device yields zero information
 * about the KEK without the remaining shares.
 */
export interface ThresholdKEKDerivation {
  shares: ThresholdShare[];
  threshold: number;
  /** Blake3 commitment to the full signer set, stored on-chain */
  commitment: string;
}
