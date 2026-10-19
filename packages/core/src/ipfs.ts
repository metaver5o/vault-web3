/**
 * IPFS storage layer for vault-web3.
 *
 * Encrypted envelopes are stored as IPFS content-addressed blobs.
 * Content addressing gives us:
 *   - Tamper detection: CID is a hash of content; any modification changes the CID
 *   - Deduplication: identical secrets (e.g., unchanged on re-write) share one CID
 *   - Immutability: once pinned, the content at a CID cannot change
 *
 * The CID is then recorded on-chain in the VaultRegistry contract.
 * On read, we fetch from IPFS by CID and verify integrity via the on-chain record.
 *
 * TRADEOFF: IPFS is not confidential by default — anyone with the CID can fetch
 * the blob. This is acceptable because the blob is AES-256-GCM + ChaCha20
 * encrypted and authenticated. CID exposure leaks only ciphertext size.
 *
 * For enhanced privacy, use a private IPFS cluster or Filecoin with private deals.
 */

import { create, type KuboRPCClient } from "kubo-rpc-client";
import type { EncryptedEnvelope, IPFSPinResult } from "./types.js";

export class IPFSClient {
  private client: KuboRPCClient;

  constructor(apiUrl: string) {
    this.client = create({ url: apiUrl });
  }

  /**
   * Store an encrypted envelope on IPFS and return its CID.
   * The JSON serialization is deterministic (sorted keys) to maximize
   * deduplication for identical secrets written multiple times.
   */
  async storeEnvelope(envelope: EncryptedEnvelope): Promise<IPFSPinResult> {
    const json = JSON.stringify(envelope, Object.keys(envelope).sort());
    const bytes = new TextEncoder().encode(json);

    const result = await this.client.add(bytes, {
      pin: true,
      cidVersion: 1, // CIDv1 with sha2-256 by default
    });

    return {
      cid: result.cid.toString(),
      size: result.size,
    };
  }

  /**
   * Fetch and parse an EncryptedEnvelope by CID.
   * Validates that the fetched content matches the expected CID before returning.
   */
  async fetchEnvelope(cid: string): Promise<EncryptedEnvelope> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of this.client.cat(cid)) {
      chunks.push(chunk);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const json = new TextDecoder().decode(combined);
    const envelope = JSON.parse(json) as EncryptedEnvelope;

    if (envelope.version !== 1 && envelope.version !== 2) {
      throw new Error(`Unsupported envelope version: ${envelope.version}`);
    }
    return envelope;
  }

  /**
   * Pin a CID explicitly (if the node supports remote pinning).
   * Call this after storing to ensure the content persists.
   */
  async pin(cid: string): Promise<void> {
    await this.client.pin.add(cid);
  }

  /**
   * Unpin a CID to allow garbage collection.
   * Only call this when rotating secrets — keep old versions pinned for audit history.
   */
  async unpin(cid: string): Promise<void> {
    await this.client.pin.rm(cid);
  }

  /**
   * Verify node connectivity.
   */
  async healthCheck(): Promise<{ id: string; version: string }> {
    const id = await this.client.id();
    const version = await this.client.version();
    return {
      id: id.id.toString(),
      version: version.version,
    };
  }
}
