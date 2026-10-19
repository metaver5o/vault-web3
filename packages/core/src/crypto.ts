/**
 * Client-side cryptography for vault-web3.
 *
 * All operations use the Web Crypto API (SubtleCrypto) — runs in both
 * Node.js (≥20) and the browser without any polyfills.
 *
 * Encryption scheme:
 *   DEK  = random 256-bit AES-256-GCM key
 *   KEK  = HKDF-SHA256(Trezor_sig, salt=SHA256(namespace), info="vault-web3-kek-v1:<idx>")
 *   encryptedDek = AES-256-GCM(KEK, DEK_raw_bytes)
 *   encryptedData = AES-256-GCM(DEK, plaintext)
 *
 * NOTE: The original design used ChaCha20-Poly1305 for payload encryption.
 * SubtleCrypto does not yet support ChaCha20, so we use AES-256-GCM for both
 * layers. The security properties are equivalent in the browser threat model.
 */

import type {
  EncryptedEnvelope,
  DerivedKeys,
  ThresholdShare,
} from "./types.js";

// ─── Utilities ────────────────────────────────────────────────────────────────

const subtle = globalThis.crypto.subtle;

/**
 * SubtleCrypto requires a plain ArrayBuffer (not SharedArrayBuffer).
 * TypeScript's DOM lib types enforce this via the `BufferSource` type.
 * This helper copies any Uint8Array into a guaranteed ArrayBuffer.
 */
function ab(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toBase64url(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function zeroFill(buf: Uint8Array): void {
  buf.fill(0);
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest("SHA-256", ab(data)));
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// ─── HKDF (SubtleCrypto native) ───────────────────────────────────────────────

async function hkdfSHA256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  length = 32
): Promise<Uint8Array> {
  const ikmKey = await subtle.importKey(
    "raw", ab(ikm), { name: "HKDF" }, false, ["deriveBits"]
  );
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: ab(salt), info: ab(utf8(info)) },
    ikmKey,
    length * 8
  );
  return new Uint8Array(bits);
}

// ─── KEK Derivation ───────────────────────────────────────────────────────────

export async function deriveKEKFromSignature(
  hexSignature: string,
  namespace: string,
  derivationIndex: number
): Promise<DerivedKeys> {
  const ikm = hexToBytes(hexSignature);
  const salt = await sha256(utf8(namespace));
  const info = `vault-web3-kek-v1:${derivationIndex}`;
  const kekRaw = await hkdfSHA256(ikm, salt, info, 32);

  const kek = await subtle.importKey(
    "raw",
    ab(kekRaw),
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey", "encrypt", "decrypt"]
  );

  zeroFill(ikm);
  return { kek, kekRaw };
}

export async function xorCombineKEKShares(
  shares: ThresholdShare[],
  namespace: string
): Promise<DerivedKeys> {
  const shareKeys = await Promise.all(
    shares.map(async (share) => {
      const saltInput = utf8(`${namespace}:${share.signer}`);
      const salt = await sha256(saltInput);
      return hkdfSHA256(
        hexToBytes(share.signature),
        salt,
        `vault-web3-kek-v1:threshold:${share.signer}`,
        32
      );
    })
  );

  const combined = new Uint8Array(32);
  for (const sk of shareKeys) {
    for (let i = 0; i < 32; i++) combined[i] ^= sk[i];
    zeroFill(sk);
  }

  const kek = await subtle.importKey(
    "raw",
    ab(combined),
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey", "encrypt", "decrypt"]
  );

  const kekRaw = combined.slice();
  return { kek, kekRaw };
}

// ─── AES-256-GCM ─────────────────────────────────────────────────────────────

async function aesGcmEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array
): Promise<{ iv: Uint8Array; tag: Uint8Array; ciphertext: Uint8Array }> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv: ab(iv), tagLength: 128 }, key, ab(plaintext))
  );
  const ciphertext = encrypted.slice(0, -16);
  const tag = encrypted.slice(-16);
  return { iv, tag, ciphertext };
}

async function aesGcmDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  tag: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  const withTag = new Uint8Array(ciphertext.length + tag.length);
  withTag.set(ciphertext);
  withTag.set(tag, ciphertext.length);
  return new Uint8Array(
    await subtle.decrypt({ name: "AES-GCM", iv: ab(iv), tagLength: 128 }, key, ab(withTag))
  );
}

// ─── DEK Generation ───────────────────────────────────────────────────────────

async function generateDEK(
  quantumEntropy?: Uint8Array,
  namespace?: string
): Promise<CryptoKey> {
  const csprngKey = await subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  if (!quantumEntropy || !namespace) return csprngKey;

  const csprngRaw = new Uint8Array(await subtle.exportKey("raw", csprngKey));
  const qSalt = await sha256(utf8(namespace));
  const qExpanded = await hkdfSHA256(quantumEntropy, qSalt, "vault-web3-dek-qseed", 32);

  const mixed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) mixed[i] = csprngRaw[i] ^ qExpanded[i];
  zeroFill(csprngRaw);
  zeroFill(qExpanded);

  return subtle.importKey("raw", ab(mixed), { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

// ─── Envelope Encrypt / Decrypt ───────────────────────────────────────────────

const toHex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

/** HMAC-SHA256 of the plaintext under a key derived from the KEK. */
async function integrityTag(kekRaw: Uint8Array, plaintextBytes: Uint8Array): Promise<string> {
  const macRaw = await hkdfSHA256(kekRaw, new Uint8Array(32), "vault-web3-integrity-v1", 32);
  const macKey = await subtle.importKey("raw", ab(macRaw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  zeroFill(macRaw);
  return toHex(new Uint8Array(await subtle.sign("HMAC", macKey, ab(plaintextBytes))));
}

export async function encryptSecret(
  plaintext: Record<string, string>,
  derivedKeys: DerivedKeys,
  derivationPath: string,
  chainId: number,
  quantumEntropy?: Uint8Array,
  namespace?: string
): Promise<EncryptedEnvelope> {
  const plaintextBytes = utf8(JSON.stringify(plaintext));

  // 1. Generate DEK
  const dek = await generateDEK(quantumEntropy, namespace);
  const dekRaw = new Uint8Array(await subtle.exportKey("raw", dek));

  // 2. Encrypt payload with AES-256-GCM (using raw DEK bytes as key)
  const dekKey = await subtle.importKey(
    "raw", ab(dekRaw), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
  const { iv: dataNonce, tag: dataTag, ciphertext: encData } = await aesGcmEncrypt(dekKey, plaintextBytes);

  // 3. Wrap DEK with KEK
  const { iv: dekIv, tag: dekTag, ciphertext: encryptedDek } = await aesGcmEncrypt(derivedKeys.kek, dekRaw);

  // 4. Keyed integrity tag. The envelope sits on public IPFS and its hash goes on-chain,
  //    so a bare SHA-256 of the plaintext would let anyone confirm a guessed secret.
  //    HMAC with a key derived from the KEK can only be checked by whoever holds the KEK.
  const plaintextHash = await integrityTag(derivedKeys.kekRaw, plaintextBytes);

  zeroFill(dekRaw);

  // Store payload as ciphertext+GCM-tag combined
  const combined = new Uint8Array(encData.length + dataTag.length);
  combined.set(encData);
  combined.set(dataTag, encData.length);

  return {
    version: 2,
    algorithm: "AES-256-GCM+AES-256-GCM",
    dekIv: toBase64url(dekIv),
    dekTag: toBase64url(dekTag),
    encryptedDek: toBase64url(encryptedDek),
    dataNonce: toBase64url(dataNonce),
    encryptedData: toBase64url(combined),
    plaintextHash,
    derivationPath,
    chainId,
  };
}

export async function decryptSecret(
  envelope: EncryptedEnvelope,
  derivedKeys: DerivedKeys
): Promise<Record<string, string>> {
  const dekIv = fromBase64url(envelope.dekIv);
  const dekTag = fromBase64url(envelope.dekTag);
  const encryptedDek = fromBase64url(envelope.encryptedDek);
  const dataNonce = fromBase64url(envelope.dataNonce);

  const encDataBuf = fromBase64url(envelope.encryptedData);
  const ciphertext = encDataBuf.slice(0, -16);
  const dataTag = encDataBuf.slice(-16);

  // 1. Unwrap DEK
  const dekRaw = await aesGcmDecrypt(derivedKeys.kek, dekIv, dekTag, encryptedDek);

  // 2. Decrypt payload
  const dekKey = await subtle.importKey(
    "raw", ab(dekRaw), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
  const plaintextBytes = await aesGcmDecrypt(dekKey, dataNonce, dataTag, ciphertext);
  zeroFill(dekRaw);

  // 3. Verify integrity (version 1 envelopes used an unkeyed SHA-256)
  const actualHash = envelope.version >= 2
    ? await integrityTag(derivedKeys.kekRaw, plaintextBytes)
    : toHex(await sha256(plaintextBytes));
  if (actualHash !== envelope.plaintextHash) {
    throw new Error("Integrity check failed: plaintext hash mismatch.");
  }

  return JSON.parse(new TextDecoder().decode(plaintextBytes));
}

// ─── Commitment Hash ──────────────────────────────────────────────────────────

export async function computeSignerCommitment(signers: string[]): Promise<string> {
  const sorted = [...signers].sort();
  const hashBuf = await sha256(utf8(sorted.join(":")));
  return Array.from(hashBuf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function namespaceToIndex(namespace: string): number {
  // Simple deterministic hash without Node crypto
  let h = 0x811c9dc5;
  for (let i = 0; i < namespace.length; i++) {
    h ^= namespace.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h & 0x7fffffff;
}
