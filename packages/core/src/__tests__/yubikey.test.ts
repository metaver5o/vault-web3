/**
 * YubiKey backend tests. The authenticator is mocked the way a real key behaves:
 * PRF output = HMAC-SHA256(secret held on the key, salt), stable per credential.
 */

import { ethers } from "ethers";
import { YubiKeyVault, registerYubiKey, prfSalt, YubiKeyNotReady } from "../yubikey.js";
import { encryptSecret, decryptSecret } from "../crypto.js";

const subtle = globalThis.crypto.subtle;
const wallet = ethers.Wallet.createRandom();
const CRED = { credentialId: "AAECAwQFBgcICQ", rpId: "localhost" };

async function hmacKey(seed: string) {
  const raw = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(seed) as Uint8Array<ArrayBuffer>));
  return subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

/** Install a fake WebAuthn whose key holds `seed`; `fail` makes get() throw. */
function installAuthenticator(seed: string, opts: { fail?: string; prf?: boolean } = {}) {
  (globalThis as any).PublicKeyCredential = class {};
  const credentials = {
    async create() {
      if (opts.fail) throw Object.assign(new Error(opts.fail), { name: opts.fail });
      return { rawId: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer, getClientExtensionResults: () => ({ prf: { enabled: opts.prf !== false } }) };
    },
    async get(req: any) {
      if (opts.fail) throw Object.assign(new Error(opts.fail), { name: opts.fail });
      const salt = req.publicKey.extensions.prf.eval.first as Uint8Array;
      const first = opts.prf === false ? undefined : await subtle.sign("HMAC", await hmacKey(seed), salt as Uint8Array<ArrayBuffer>);
      return { getClientExtensionResults: () => ({ prf: first ? { results: { first } } : {} }) };
    },
  };
  Object.defineProperty(globalThis, "navigator", { value: { credentials }, configurable: true });
}

function uninstall() {
  delete (globalThis as any).PublicKeyCredential;
  Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
}

afterEach(uninstall);

describe("YubiKeyVault (WebAuthn PRF)", () => {
  it("salt is SHA-256 of the same message the Trezor signs", async () => {
    const salt = await prfSalt("secret/app/db", 0);
    const expected = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode("vault-web3:kek:v1:secret/app/db:0") as Uint8Array<ArrayBuffer>));
    expect(Buffer.from(salt).toString("hex")).toBe(Buffer.from(expected).toString("hex"));
  });

  it("derives the same KEK every time for the same key and path", async () => {
    installAuthenticator("key-A");
    const v = new YubiKeyVault(CRED, wallet);
    const a = await v.deriveKEK("secret/app/db");
    const b = await v.deriveKEK("secret/app/db");
    expect(Buffer.from(a.kekRaw).toString("hex")).toBe(Buffer.from(b.kekRaw).toString("hex"));
  });

  it("different path or different key → different KEK", async () => {
    installAuthenticator("key-A");
    const v = new YubiKeyVault(CRED, wallet);
    const a = Buffer.from((await v.deriveKEK("secret/app/db")).kekRaw).toString("hex");
    const b = Buffer.from((await v.deriveKEK("secret/app/other")).kekRaw).toString("hex");
    installAuthenticator("key-B");
    const c = Buffer.from((await v.deriveKEK("secret/app/db")).kekRaw).toString("hex");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("encrypts and decrypts a secret end to end", async () => {
    installAuthenticator("key-A");
    const v = new YubiKeyVault(CRED, wallet);
    const env = await encryptSecret({ token: "xyz" }, await v.deriveKEK("secret/app/db"), "yubikey", 31337);
    expect(await decryptSecret(env, await v.deriveKEK("secret/app/db"))).toEqual({ token: "xyz" });
  });

  it("a different YubiKey can't decrypt", async () => {
    installAuthenticator("key-A");
    const env = await encryptSecret({ token: "xyz" }, await new YubiKeyVault(CRED, wallet).deriveKEK("p"), "yubikey", 31337);
    installAuthenticator("key-B");
    await expect(decryptSecret(env, await new YubiKeyVault(CRED, wallet).deriveKEK("p"))).rejects.toThrow();
  });

  it("uses the wallet for address and transactions", async () => {
    const v = new YubiKeyVault(CRED, wallet);
    expect(await v.getAddress()).toBe(wallet.address);
    expect(await v.getEthersSigner()).toBe(wallet);
    expect(v.signerType).toBe("yubikey");
  });
});

describe("YubiKey not ready: every failure comes with a how-to", () => {
  const expectProblem = async (p: Promise<unknown>, code: string) => {
    const err = await p.then(() => null, (e) => e);
    expect(err).toBeInstanceOf(YubiKeyNotReady);
    expect(err.code).toBe(code);
    expect(err.howto.length).toBeGreaterThan(30);
  };

  it("no WebAuthn in this browser", async () => {
    uninstall();
    await expectProblem(new YubiKeyVault(CRED, wallet).deriveKEK("p"), "no-webauthn");
  });

  it("not registered yet", async () => {
    installAuthenticator("key-A");
    await expectProblem(new YubiKeyVault(null, wallet).deriveKEK("p"), "not-registered");
  });

  it("touch timed out or prompt cancelled", async () => {
    installAuthenticator("key-A", { fail: "NotAllowedError" });
    await expectProblem(new YubiKeyVault(CRED, wallet).deriveKEK("p"), "cancelled-or-timeout");
  });

  it("key without PRF (old firmware or browser)", async () => {
    installAuthenticator("key-A", { prf: false });
    await expectProblem(registerYubiKey(), "no-prf");
    await expectProblem(new YubiKeyVault(CRED, wallet).deriveKEK("p"), "no-prf");
  });

  it("wrong key plugged in", async () => {
    installAuthenticator("key-A", { fail: "InvalidStateError" });
    await expectProblem(new YubiKeyVault(CRED, wallet).deriveKEK("p"), "wrong-key");
  });

  it("registration returns a storable credential", async () => {
    installAuthenticator("key-A");
    const c = await registerYubiKey({ rpId: "localhost" });
    expect(c.rpId).toBe("localhost");
    expect(c.credentialId).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
