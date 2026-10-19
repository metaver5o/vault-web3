/**
 * QSHaaS (Quantum Seed as a Service) integration.
 *
 * Fetches quantum-derived entropy from api.criptografia.net to supplement
 * the CSPRNG when generating Data Encryption Keys.
 *
 * Integration point in envelope encryption:
 *   DEK = XOR(CSPRNG_bytes, HKDF(quantum_entropy, "vault-web3-dek-qseed", namespace))
 *
 * Why XOR and not replace?
 *   The CSPRNG output is never weakened — XOR with any independent source
 *   can only maintain or improve entropy. If QSHaaS is unavailable or returns
 *   low-quality entropy, the DEK falls back to pure CSPRNG (no degradation).
 *
 * This is enabled per-write via the `useQuantumSeed` flag on WriteSecretRequest.
 */

export interface QSHaaSConfig {
  apiUrl: string;        // e.g. "https://api.criptografia.net"
  apiKey: string;
  algorithm?: string;   // default "sha3-256"
  bits?: number;        // default 256
}

export interface QSHaaSResponse {
  success: boolean;
  data: {
    hash: string;
    algorithm: string;
    bits_generated: number;
    backend: string;
    job_id: string;
    attestation: {
      signature: string;
      data: Record<string, unknown>;
    };
  };
}

export interface QuantumEntropy {
  /** Raw 32-byte quantum entropy derived from QSHaaS output */
  bytes: Uint8Array;
  /** QSHaaS job ID for auditability */
  jobId: string;
  /** Backend that generated the entropy (e.g. "IBM_BRISBANE", "Hybrid") */
  backend: string;
}

/**
 * Fetch a single entropy blob from QSHaaS.
 * Returns null if the request fails — callers should fall back to pure CSPRNG.
 */
export async function fetchQuantumEntropy(
  config: QSHaaSConfig
): Promise<QuantumEntropy | null> {
  try {
    const res = await fetch(`${config.apiUrl}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify({
        algorithm: config.algorithm ?? "sha3-256",
        bits: config.bits ?? 256,
      }),
      signal: AbortSignal.timeout(8000), // 8 second timeout
    });

    if (!res.ok) {
      console.warn(`[QSHaaS] Request failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const json = (await res.json()) as QSHaaSResponse;
    if (!json.success) {
      console.warn("[QSHaaS] API returned success=false");
      return null;
    }

    // The hash field is hex-encoded entropy from the quantum backend
    const hexHash = json.data.hash.replace(/^0x/, "");
    const entropyBytes = hexHash.length >= 64
      ? Uint8Array.from(Buffer.from(hexHash.slice(0, 64), "hex"))
      : await padToBytes(hexHash);

    return {
      bytes: entropyBytes,
      jobId: json.data.job_id,
      backend: json.data.backend,
    };
  } catch (err) {
    console.warn("[QSHaaS] Entropy fetch failed:", (err as Error).message);
    return null;
  }
}

/**
 * Validate that the QSHaaS API key and endpoint are reachable.
 */
export async function checkQSHaaSStatus(
  config: QSHaaSConfig
): Promise<{ online: boolean; version?: string; algorithms?: string[] }> {
  try {
    const res = await fetch(`${config.apiUrl}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { online: false };
    const json = await res.json();
    return {
      online: true,
      version: json.version,
      algorithms: json.algorithms,
    };
  } catch {
    return { online: false };
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

import { createHash } from "crypto";

/**
 * If the QSHaaS hash is shorter than 32 bytes (shouldn't happen with sha3-256),
 * hash-expand it to exactly 32 bytes.
 */
async function padToBytes(hex: string): Promise<Uint8Array> {
  const raw = Buffer.from(hex, "hex");
  const expanded = createHash("sha256").update(raw).digest();
  return new Uint8Array(expanded);
}
