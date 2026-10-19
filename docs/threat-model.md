# Threat Model: vault-web3 vs HashiCorp Vault

## Attack Surface Comparison

| Surface                        | HashiCorp Vault                              | vault-web3                                          | Delta     |
|-------------------------------|----------------------------------------------|-----------------------------------------------------|-----------|
| **Server process**            | Vault daemon (Go, ~50MB binary) always on    | No persistent server                                | ✅ Removed |
| **Root token**                | Exists, stored/transmitted                   | Does not exist; KEK lives only in Trezor            | ✅ Removed |
| **Unseal keys (Shamir)**      | Stored by operators, transmittable           | Hardware-enforced; requires physical device         | ✅ Improved |
| **Plaintext secrets in RAM**  | During transit through Vault server          | Only in client process during decrypt window (~ms)  | ✅ Improved |
| **TLS private key**           | Vault server terminates TLS                  | No server; TLS only on API if deployed              | ✅ Reduced |
| **Audit log tampering**       | Log file can be rotated/deleted              | On-chain events; immutable                          | ✅ Improved |
| **Vendor/SaaS risk**          | HashiCorp license, HCP Vault cloud           | Zero vendor dependency                              | ✅ Eliminated |
| **Single point of failure**   | Vault HA cluster                             | IPFS (DHT) + L2 chain (decentralized)               | ✅ Distributed |
| **Smart contract bugs**       | N/A                                          | Diamond proxy upgrade path; auditable               | ⚠️ New surface |
| **IPFS CID exposure**         | N/A                                          | CID is public; ciphertext is exposed (not plaintext)| ⚠️ Acceptable |
| **L2 chain availability**     | N/A                                          | Depends on zkSync Era / Polygon zkEVM uptime        | ⚠️ New dependency |
| **Trezor firmware bugs**      | N/A                                          | Upstream supply-chain risk                          | ⚠️ Hardware risk |
| **USB/Bridge MITM**           | N/A                                          | Trezor Bridge on localhost; verify bridge integrity | ⚠️ Local surface |

---

## Threat Scenarios

### T1: Compromised Client Machine (Malware)
**HashiCorp Vault:** Vault token can be exfiltrated from disk/env. Attacker can read all secrets the token has access to without physical interaction.

**vault-web3:** Attacker can:
- ✅ NOT derive the KEK — requires Trezor physical confirmation
- ✅ NOT extract the Trezor seed
- ⚠️ CAN intercept decrypted plaintext after the decrypt call returns (memory scraping)
- ⚠️ CAN manipulate the message shown to the user (UI spoofing — user must read the Trezor screen)

**Mitigation:** Short-lived process memory (zero-fill after use in `crypto.ts`). User must verify the namespace displayed on Trezor.

---

### T2: Trezor Physical Theft
**Attacker has:** Trezor device only (no PIN).

**vault-web3:** PIN protects the device. After N failed attempts, Trezor wipes itself.

**Attacker has:** Trezor + PIN.

**vault-web3:** KEK can be reproduced. Attacker can decrypt secrets **if they also have the encrypted IPFS blobs**. Blobs are public on IPFS — CID must remain private.

**Mitigation:** Rotate secrets immediately on device loss (change `derivationIndex` in `WriteSecretRequest`). Old secrets can be re-encrypted with a new KEK derived at `derivationIndex=1`.

---

### T3: Smart Contract Vulnerability (Access Control Bypass)
An attacker exploits a bug in `AccessControlFacet` to grant themselves a Writer role.

**Impact:** They can record arbitrary CIDs on-chain for a path — pointing to attacker-controlled ciphertext. However, they **cannot decrypt existing secrets** (no Trezor). They can cause DoS on a path by overwriting the latest CID.

**Mitigation:**
- Diamond upgradeability allows patching facets
- Emergency `setPaused()` function for owner to halt all writes
- Formal verification of access control logic (recommended for production)

---

### T4: IPFS Content Addressing Attack (CID Collision)
SHA-256 collision attack to produce a fake envelope with the same CID.

**Impact:** If a collision were found, an attacker could substitute a malicious envelope. However:
- SHA-256 collision resistance is ~2^128 operations (infeasible)
- Even with a collision, the AES-GCM tags (DEK wrap and payload) would fail
- The HMAC integrity tag provides a third layer of integrity

**Verdict:** Negligible risk. CIDv1 with SHA-256 is the standard; upgrade to SHA3-256 CIDs available via IPFS if desired.

---

### T5: L2 Chain Reorganization
A deep reorg on the L2 could erase recently recorded CID entries.

**Impact:** A read after reorg would return an older version's CID. The decrypted data would be an older (valid) secret version, not corrupted data.

**Mitigation:**
- Wait for multiple confirmations before treating a write as final (configurable `wait(N)` in `registry.ts`)
- zkSync Era and Polygon zkEVM have strong finality guarantees via ZK proofs submitted to Ethereum L1

---

### T6: Signature Replay (KEK Derivation Reuse)
An attacker captures a signature used for KEK derivation and replays it.

**Impact:** The captured signature IS the KEK derivation input. If an attacker gets the 65-byte signature from memory, they can derive the KEK without the Trezor.

**Mitigation:**
- Zero-fill the signature bytes immediately after HKDF in `crypto.ts` (`zeroFill(ikm)`)
- The signature is computed fresh for each operation — there is no stored/cached signature
- Short window of exposure: signature exists in memory only during the HKDF call

---

### T7: Bridge/USB MITM (Malicious Trezor Bridge)
A compromised `trezord` binary intercepts signing requests, shows user-approved text, but sends different data to the device.

**Impact:** User confirms a different message than intended.

**Mitigation:**
- The Trezor screen shows the message (`vault-web3:kek:v1:<path>:<index>`) — user must verify the path displayed matches their intent
- Use official Trezor Bridge from Trezor's signed releases only
- Hardware attestation: Trezor Suite verifies bridge binary hash

---

### T8: Guessing Secrets from Public Hashes
The envelope is public on IPFS and its integrity value is recorded on-chain. If that value were a plain hash of the plaintext, anyone could test guesses offline: a low-entropy secret (a password, a short API key) would be confirmed by hashing candidates.

**Impact (envelope version 1):** Version 1 envelopes stored an unkeyed SHA-256 of the plaintext. They leak a guessing oracle and should be rewritten.

**Mitigation (envelope version 2, current):** The integrity value is an HMAC-SHA256 under a key derived from the KEK. Without the Trezor it can't be computed, so it confirms nothing. Reading a version 1 envelope still works; writing always produces version 2.

---

## What This Design Does Not Protect Against

- **A compromised machine while you use it.** Malware on the client sees plaintext after decryption and can ask you to approve signatures. The Trezor screen is the only check.
- **Your Trezor and its PIN, together.** Whoever holds both can derive every KEK. Use a passphrase and keep the seed backup offline.
- **Metadata.** Secret paths, write times, authors and version counts are public on-chain, and ciphertext sizes are public on IPFS. Use opaque path names if the names themselves are sensitive.
- **Taking back a secret someone already read.** Revoking a role stops future writes; it can't recall plaintext that was decrypted before. Rotate the secret.
- **On-chain roles as read control.** Roles gate who can record versions. Reading is gated only by holding the KEK, which today means the owner's device (or the threshold set).
- **The Diamond owner key.** The owner can cut new facets, which changes contract logic. Put the owner behind a multisig and a timelock before production.
- **Availability you don't pay for.** A CID that nobody pins can disappear from IPFS. Pin to at least two providers you control.
- **Unaudited code.** Neither the contracts nor the crypto library have had an external audit.
- **Losing a YubiKey.** With the YubiKey signer, each key derives its own KEKs and a secret is wrapped for one key only. A lost or reset key means the secrets it wrote are unrecoverable. See [yubikey.md](yubikey.md).
- **Moving the vault to another domain (YubiKey).** WebAuthn credentials are bound to the site's domain; the same key on another domain derives different KEKs.

---

## Security Properties Summary

| Property                  | Guarantee                                              |
|--------------------------|-------------------------------------------------------|
| Confidentiality          | AES-256-GCM (DEK wrap) + AES-256-GCM (payload)        |
| Integrity                | GCM tags + HMAC-SHA256 tag keyed from the KEK         |
| Authentication           | Message signed on the Trezor (EIP-191, hardware-enforced); EIP-712 typed data with MetaMask |
| Non-repudiation          | On-chain Ethereum address tied to every write event   |
| Key custody              | Hardware-enforced (Trezor; KEK never in RAM > ~50ms)  |
| Audit trail              | Immutable on-chain event log; cannot be deleted       |
| Availability             | IPFS DHT + L2 chain (no single point of failure)      |
| Recoverability           | Trezor seed → all KEKs; IPFS CIDs from on-chain log   |

---

## Cryptographic Assumptions

1. **secp256k1 ECDSA security:** Trezor signatures are computationally indistinguishable from random given an unknown private key. Standard assumption; currently 128-bit security.

2. **HKDF-SHA256 security:** Given pseudorandom IKM (the signature), HKDF output is computationally indistinguishable from random. Proven secure under ROM (Random Oracle Model) — RFC 5869.

3. **AES-256-GCM IND-CCA2:** Under nonce uniqueness. The DEK wrap uses a random 96-bit nonce under a long-lived KEK; the payload uses a fresh random DEK per secret version, so its nonce is never reused under the same key.

4. **HMAC-SHA256 as a PRF:** The integrity tag is keyed with HKDF(KEK, "vault-web3-integrity-v1"), so it reveals nothing about the plaintext to anyone without the KEK.

5. **XOR KEK combination security:** Each HKDF output is pseudorandom conditioned on a unique (signer, namespace) pair. XOR of independent PRF outputs is pseudorandom IFF all inputs are. Any single corrupted device leaks zero information about the combined key.

**Known limitation:** If the Trezor's secp256k1 implementation has a bias (e.g., nonce bias in signing), HKDF entropy could be reduced. Trezor uses RFC 6979 deterministic nonces — no bias expected, but this is an assumption about the closed-source firmware.
