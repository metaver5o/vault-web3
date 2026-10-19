/**
 * YubiKey signing backend for vault-web3 (WebAuthn PRF / CTAP2 hmac-secret).
 *
 * A YubiKey's ECDSA signatures are randomized, so they can't seed a key that
 * has to come out the same every time. The PRF extension can: the key computes
 * HMAC-SHA256(secret-on-the-key, salt) and returns 32 bytes that are stable for
 * a given credential and salt. One touch per operation.
 *
 *   salt = SHA-256("vault-web3:kek:v1:<namespace>:<idx>")   (same string the Trezor signs)
 *   IKM  = PRF(credential, salt)                             (32 bytes, never leaves the browser tab)
 *   KEK  = HKDF-SHA256(IKM, ...)                             (same derivation as Trezor/MetaMask)
 *
 * A YubiKey can't sign Ethereum transactions, so on-chain writes go through a
 * separate wallet (any EIP-1193 wallet, e.g. MetaMask). The YubiKey protects the
 * secrets; the wallet only pays for and signs the registry transactions.
 *
 * Each credential has its own PRF secret: a second YubiKey derives different KEKs
 * and can't read what the first one wrote. See docs/yubikey.md for backup advice.
 *
 * BROWSER ONLY: needs navigator.credentials (WebAuthn) in a secure context.
 */

import type { ethers } from "ethers";
import type { VaultSigner } from "./signer.js";
import type { DerivedKeys, ThresholdShare } from "./types.js";
import { deriveKEKFromSignature } from "./crypto.js";

export interface YubiKeyCredential {
  /** base64url credential id, safe to store (it isn't secret) */
  credentialId: string;
  /** relying party id the credential was made for (usually the site's host) */
  rpId: string;
}

/** An error with a fix the user can follow; `howto` is plain text for the UI. */
export class YubiKeyNotReady extends Error {
  constructor(readonly code: YubiKeyProblem, message: string, readonly howto: string) {
    super(message);
    this.name = "YubiKeyNotReady";
  }
}

export type YubiKeyProblem =
  | "no-webauthn" | "insecure-context" | "no-prf" | "cancelled-or-timeout"
  | "no-pin" | "wrong-key" | "not-registered" | "unknown";

const HOWTO: Record<YubiKeyProblem, string> = {
  "no-webauthn": "This browser has no WebAuthn. Use a current Chrome, Edge, Brave, Safari 18+ or Firefox 135+.",
  "insecure-context": "WebAuthn only works over HTTPS or on localhost. Open the vault on https:// or http://localhost.",
  "no-prf": "The key or browser doesn't support the PRF extension (FIDO2 hmac-secret). You need a FIDO2 YubiKey (YubiKey 5, Security Key or Bio series) and a browser with PRF support, such as current Chrome. Run `ykman info` and check that FIDO2 is enabled. U2F-only keys (YubiKey 4, NEO) can't be used.",
  "cancelled-or-timeout": "Nothing was touched in time, or the prompt was cancelled. Plug the key in, click again, and touch the gold contact when it blinks.",
  "no-pin": "The key needs a FIDO2 PIN before it can verify you. Set one with `ykman fido access change-pin` (or Yubico Authenticator → Passkeys → Set PIN), then try again.",
  "wrong-key": "This key doesn't hold the registered credential. Use the YubiKey you registered with, or register this one (it will derive different keys and can't read secrets written by the other).",
  "not-registered": "No YubiKey is registered in this browser yet. Click \"Register YubiKey\" first.",
  "unknown": "The key returned an unexpected error. Unplug it, plug it back in, and try again. See docs/yubikey.md for the full checklist.",
};

const TITLE: Record<YubiKeyProblem, string> = {
  "no-webauthn": "This browser can't talk to security keys.",
  "insecure-context": "Security keys need a secure page.",
  "no-prf": "This key can't derive vault keys (no PRF support).",
  "cancelled-or-timeout": "The YubiKey wasn't touched in time.",
  "no-pin": "The YubiKey has no FIDO2 PIN yet.",
  "wrong-key": "That's not the registered YubiKey.",
  "not-registered": "No YubiKey registered yet.",
  "unknown": "The YubiKey returned an error.",
};

export function yubikeyProblem(code: YubiKeyProblem, message?: string): YubiKeyNotReady {
  return new YubiKeyNotReady(code, TITLE[code], message ?? HOWTO[code]);
}

const b64u = {
  encode: (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};
const toHex = (b: Uint8Array) => "0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

/** The salt for one (namespace, index): SHA-256 of the same message the Trezor signs. */
export async function prfSalt(namespace: string, derivationIndex: number): Promise<Uint8Array> {
  const msg = new TextEncoder().encode(`vault-web3:kek:v1:${namespace}:${derivationIndex}`) as Uint8Array<ArrayBuffer>;
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", msg));
}

/** Map a WebAuthn DOMException to a problem with a how-to. */
export function explainWebAuthnError(err: unknown): YubiKeyNotReady {
  if (err instanceof YubiKeyNotReady) return err;
  const name = (err as { name?: string })?.name ?? "";
  const msg = String((err as { message?: string })?.message ?? err);
  if (name === "NotAllowedError") return yubikeyProblem("cancelled-or-timeout");
  if (name === "InvalidStateError") return yubikeyProblem("wrong-key");
  if (name === "SecurityError") return yubikeyProblem("insecure-context");
  if (name === "NotSupportedError") return yubikeyProblem("no-prf");
  if (/pin/i.test(msg)) return yubikeyProblem("no-pin");
  return yubikeyProblem("unknown", `${HOWTO.unknown} (${name || "Error"}: ${msg})`);
}

function webauthn(): CredentialsContainer {
  if (typeof window !== "undefined" && window.isSecureContext === false) throw yubikeyProblem("insecure-context");
  const c = (globalThis as { navigator?: Navigator }).navigator?.credentials;
  if (!c || typeof (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential === "undefined") throw yubikeyProblem("no-webauthn");
  return c;
}

/**
 * Register a YubiKey for vault-web3: creates a FIDO2 credential with PRF enabled.
 * Store the returned credential (e.g. in localStorage); it isn't secret.
 */
export async function registerYubiKey(opts: { rpId?: string; rpName?: string; userName?: string } = {}): Promise<YubiKeyCredential> {
  const creds = webauthn();
  const rpId = opts.rpId ?? globalThis.location?.hostname ?? "localhost";
  let cred: PublicKeyCredential | null;
  try {
    cred = (await creds.create({
      publicKey: {
        rp: { id: rpId, name: opts.rpName ?? "vault-web3" },
        user: { id: globalThis.crypto.getRandomValues(new Uint8Array(16)), name: opts.userName ?? "vault-web3", displayName: opts.userName ?? "vault-web3" },
        challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -8 }],
        authenticatorSelection: { authenticatorAttachment: "cross-platform", userVerification: "required", residentKey: "discouraged" },
        timeout: 60_000,
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw explainWebAuthnError(err);
  }
  if (!cred) throw yubikeyProblem("cancelled-or-timeout");
  const prf = (cred.getClientExtensionResults() as { prf?: { enabled?: boolean } }).prf;
  if (!prf?.enabled) throw yubikeyProblem("no-prf");
  return { credentialId: b64u.encode(new Uint8Array(cred.rawId)), rpId };
}

export class YubiKeyVault implements VaultSigner {
  readonly signerType = "yubikey" as const;

  /**
   * @param credential  from registerYubiKey()
   * @param txSigner    wallet that signs registry transactions (the YubiKey can't)
   */
  constructor(private readonly credential: YubiKeyCredential | null, private readonly txSigner: ethers.Signer) {}

  /** The wallet's address: on-chain identity for writes and the audit log. */
  async getAddress(): Promise<string> {
    return this.txSigner.getAddress();
  }

  /** 32 stable bytes from the key for this (namespace, index). One touch. */
  async prf(namespace: string, derivationIndex = 0): Promise<Uint8Array> {
    if (!this.credential) throw yubikeyProblem("not-registered");
    const creds = webauthn();
    const salt = await prfSalt(namespace, derivationIndex);
    let assertion: PublicKeyCredential | null;
    try {
      assertion = (await creds.get({
        publicKey: {
          challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
          rpId: this.credential.rpId,
          allowCredentials: [{ type: "public-key", id: b64u.decode(this.credential.credentialId) }],
          userVerification: "required",
          timeout: 60_000,
          extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null;
    } catch (err) {
      throw explainWebAuthnError(err);
    }
    if (!assertion) throw yubikeyProblem("cancelled-or-timeout");
    const first = (assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
    if (!first) throw yubikeyProblem("no-prf");
    return new Uint8Array(first);
  }

  async deriveKEK(namespace: string, derivationIndex = 0): Promise<DerivedKeys> {
    const out = await this.prf(namespace, derivationIndex);
    const keys = await deriveKEKFromSignature(toHex(out), namespace, derivationIndex);
    out.fill(0);
    return keys;
  }

  async collectThresholdShare(namespace: string, derivationIndex = 0): Promise<ThresholdShare> {
    const out = await this.prf(namespace, derivationIndex);
    const share = { signer: await this.getAddress(), signature: toHex(out), derivationPath: `yubikey:${this.credential?.credentialId.slice(0, 12)}` };
    out.fill(0);
    return share;
  }

  async getEthersSigner(_provider?: ethers.Provider): Promise<ethers.Signer> {
    return this.txSigner;
  }

  dispose(): void {}
}
