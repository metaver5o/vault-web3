/**
 * Unit tests for the crypto layer.
 *
 * These tests verify the envelope encryption/decryption round-trip and key
 * derivation behavior without requiring a physical Trezor. A mock signature
 * is used as the HKDF IKM.
 *
 * Run: npm test --workspace=packages/core
 */

import {
  deriveKEKFromSignature,
  encryptSecret,
  decryptSecret,
  computeSignerCommitment,
  namespaceToIndex,
  xorCombineKEKShares,
} from "../crypto.js";
import type { EncryptedEnvelope } from "../types.js";

// Mock 65-byte signature (r+s+v): represents the Trezor's EIP-191 signMessage output
const MOCK_SIGNATURE_A =
  "0x" + "a1".repeat(32) + "b2".repeat(32) + "1c";
const MOCK_SIGNATURE_B =
  "0x" + "c3".repeat(32) + "d4".repeat(32) + "1b";
const MOCK_ADDRESS_A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MOCK_ADDRESS_B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const NAMESPACE = "secret/test/myapp";
const DERIVATION_PATH = "m/44'/60'/0'/0/0";
const CHAIN_ID = 31337;

describe("deriveKEKFromSignature", () => {
  it("produces a non-null CryptoKey", async () => {
    const keys = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    expect(keys.kek).toBeDefined();
    expect(keys.kekRaw).toHaveLength(32);
  });

  it("is deterministic: same sig + namespace → same KEK bytes", async () => {
    const keys1 = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const keys2 = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    expect(Buffer.from(keys1.kekRaw).equals(Buffer.from(keys2.kekRaw))).toBe(true);
  });

  it("different derivation index → different KEK", async () => {
    const keys0 = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const keys1 = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 1);
    expect(Buffer.from(keys0.kekRaw).equals(Buffer.from(keys1.kekRaw))).toBe(false);
  });

  it("different namespace → different KEK", async () => {
    const keysA = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const keysB = await deriveKEKFromSignature(MOCK_SIGNATURE_A, "secret/other", 0);
    expect(Buffer.from(keysA.kekRaw).equals(Buffer.from(keysB.kekRaw))).toBe(false);
  });

  it("different signature → different KEK", async () => {
    const keysA = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const keysB = await deriveKEKFromSignature(MOCK_SIGNATURE_B, NAMESPACE, 0);
    expect(Buffer.from(keysA.kekRaw).equals(Buffer.from(keysB.kekRaw))).toBe(false);
  });
});

describe("encryptSecret / decryptSecret round-trip", () => {
  const plaintext = { password: "h0rs3b4tt3ry", apiKey: "sk-abc123", port: "5432" };

  it("round-trips plaintext correctly", async () => {
    const keys = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const envelope = await encryptSecret(plaintext, keys, DERIVATION_PATH, CHAIN_ID);

    // Re-derive keys (simulates a fresh read operation)
    const keys2 = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const decrypted = await decryptSecret(envelope, keys2);

    expect(decrypted).toEqual(plaintext);
  });

  it("produces a valid EncryptedEnvelope structure", async () => {
    const keys = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const envelope = await encryptSecret(plaintext, keys, DERIVATION_PATH, CHAIN_ID);

    expect(envelope.version).toBe(2);
    expect(envelope.algorithm).toBe("AES-256-GCM+AES-256-GCM");
    expect(envelope.dekIv).toBeTruthy();
    expect(envelope.dekTag).toBeTruthy();
    expect(envelope.encryptedDek).toBeTruthy();
    expect(envelope.dataNonce).toBeTruthy();
    expect(envelope.encryptedData).toBeTruthy();
    expect(envelope.plaintextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(envelope.derivationPath).toBe(DERIVATION_PATH);
    expect(envelope.chainId).toBe(CHAIN_ID);
  });

  it("fails decryption with wrong KEK (different signature)", async () => {
    const keysWrite = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const envelope = await encryptSecret(plaintext, keysWrite, DERIVATION_PATH, CHAIN_ID);

    const keysWrong = await deriveKEKFromSignature(MOCK_SIGNATURE_B, NAMESPACE, 0);
    await expect(decryptSecret(envelope, keysWrong)).rejects.toThrow();
  });

  it("detects tampered ciphertext via integrity check", async () => {
    const keys = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const envelope = await encryptSecret(plaintext, keys, DERIVATION_PATH, CHAIN_ID);

    // Tamper with the encrypted data
    const tampered: EncryptedEnvelope = {
      ...envelope,
      encryptedData: Buffer.from(
        Buffer.from(envelope.encryptedData, "base64url").map((b) => b ^ 0xff)
      ).toString("base64url"),
    };

    const keys2 = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    await expect(decryptSecret(tampered, keys2)).rejects.toThrow();
  });

  it("each encryption produces a unique ciphertext (random DEK/nonce)", async () => {
    const keys1 = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const env1 = await encryptSecret(plaintext, keys1, DERIVATION_PATH, CHAIN_ID);
    const keys2 = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const env2 = await encryptSecret(plaintext, keys2, DERIVATION_PATH, CHAIN_ID);

    // Different random DEK and nonce each time
    expect(env1.encryptedData).not.toBe(env2.encryptedData);
    expect(env1.dataNonce).not.toBe(env2.dataNonce);
    // But same plaintext hash
    expect(env1.plaintextHash).toBe(env2.plaintextHash);
  });
});

describe("xorCombineKEKShares (threshold unsealing)", () => {
  it("produces a stable combined KEK from 2 shares", async () => {
    const shares = [
      { signer: MOCK_ADDRESS_A, signature: MOCK_SIGNATURE_A, derivationPath: DERIVATION_PATH },
      { signer: MOCK_ADDRESS_B, signature: MOCK_SIGNATURE_B, derivationPath: DERIVATION_PATH },
    ];
    const keys1 = await xorCombineKEKShares(shares, NAMESPACE);
    const keys2 = await xorCombineKEKShares(shares, NAMESPACE);
    expect(Buffer.from(keys1.kekRaw).equals(Buffer.from(keys2.kekRaw))).toBe(true);
  });

  it("combined KEK differs from either individual share KEK", async () => {
    const shares = [
      { signer: MOCK_ADDRESS_A, signature: MOCK_SIGNATURE_A, derivationPath: DERIVATION_PATH },
      { signer: MOCK_ADDRESS_B, signature: MOCK_SIGNATURE_B, derivationPath: DERIVATION_PATH },
    ];
    const combined = await xorCombineKEKShares(shares, NAMESPACE);
    const onlyA = await xorCombineKEKShares(
      [{ signer: MOCK_ADDRESS_A, signature: MOCK_SIGNATURE_A, derivationPath: DERIVATION_PATH }],
      NAMESPACE
    );
    expect(Buffer.from(combined.kekRaw).equals(Buffer.from(onlyA.kekRaw))).toBe(false);
  });

  it("can encrypt and decrypt with combined threshold KEK", async () => {
    const plaintext = { secret: "threshold_value" };
    const shares = [
      { signer: MOCK_ADDRESS_A, signature: MOCK_SIGNATURE_A, derivationPath: DERIVATION_PATH },
      { signer: MOCK_ADDRESS_B, signature: MOCK_SIGNATURE_B, derivationPath: DERIVATION_PATH },
    ];
    const keysEnc = await xorCombineKEKShares(shares, NAMESPACE);
    const envelope = await encryptSecret(plaintext, keysEnc, DERIVATION_PATH, CHAIN_ID);

    const keysDec = await xorCombineKEKShares(shares, NAMESPACE);
    const decrypted = await decryptSecret(envelope, keysDec);
    expect(decrypted).toEqual(plaintext);
  });
});

describe("utility functions", () => {
  it("computeSignerCommitment is order-independent", async () => {
    const c1 = await computeSignerCommitment([MOCK_ADDRESS_A, MOCK_ADDRESS_B]);
    const c2 = await computeSignerCommitment([MOCK_ADDRESS_B, MOCK_ADDRESS_A]);
    expect(c1).toBe(c2);
  });

  it("namespaceToIndex is deterministic and within BIP32 range", () => {
    const idx = namespaceToIndex("secret/myapp/db");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(2 ** 31);
    expect(idx).toBe(namespaceToIndex("secret/myapp/db"));
    expect(idx).not.toBe(namespaceToIndex("secret/myapp/other"));
  });
});

describe("integrity tag", () => {
  it("cannot be reproduced from the plaintext alone", async () => {
    const keys = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const secret = { password: "hunter2" };
    const envelope = await encryptSecret(secret, keys, DERIVATION_PATH, CHAIN_ID);
    // What anyone reading IPFS or the chain could compute from a guess:
    const guess = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(secret)) as Uint8Array<ArrayBuffer>);
    const guessHex = Array.from(new Uint8Array(guess)).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(envelope.plaintextHash).not.toBe(guessHex);
    expect(envelope.plaintextHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs per KEK for the same plaintext", async () => {
    const a = await deriveKEKFromSignature(MOCK_SIGNATURE_A, NAMESPACE, 0);
    const b = await deriveKEKFromSignature(MOCK_SIGNATURE_B, NAMESPACE, 0);
    const secret = { password: "hunter2" };
    const ea = await encryptSecret(secret, a, DERIVATION_PATH, CHAIN_ID);
    const eb = await encryptSecret(secret, b, DERIVATION_PATH, CHAIN_ID);
    expect(ea.plaintextHash).not.toBe(eb.plaintextHash);
  });
});
