// End-to-end run of vault-web3 against a local Kubo IPFS node and a local Hardhat chain.
// The Trezor is replaced by a software key that signs the exact same EIP-191 message
// TrezorVault.signMessage asks the device to sign ("vault-web3:kek:v1:<path>:<idx>").
const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { ethers } = await import(`${REPO}/node_modules/ethers/lib.esm/index.js`);
const core = await import(`${REPO}/packages/core/dist/index.js`);
const { VaultClient, deriveKEKFromSignature } = core;

const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545', IPFS = process.env.IPFS_API_URL || 'http://127.0.0.1:5001', REGISTRY = process.env.REGISTRY;
if (!REGISTRY) { console.error('set REGISTRY to the Diamond address printed by the deploy script'); process.exit(1); }
const provider = new ethers.JsonRpcProvider(RPC);
const C = { dim: s => `\x1b[2m${s}\x1b[0m`, ok: s => `\x1b[32m${s}\x1b[0m`, bad: s => `\x1b[31m${s}\x1b[0m`, h: s => `\x1b[1;36m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m` };
const pause = ms => new Promise(r => setTimeout(r, +(process.env.PACE || 0) * ms));
let failed = 0;
const check = (name, cond) => { console.log(`  ${cond ? C.ok('✔') : C.bad('✘')} ${name}`); if (!cond) failed++; };

class SoftwareSigner {   // stands in for TrezorVault: same message, same signature scheme (EIP-191)
  signerType = 'trezor';
  constructor(pk) { this.wallet = new ethers.Wallet(pk, provider); this.tx = new ethers.NonceManager(this.wallet); }
  async getAddress() { return this.wallet.address; }
  async sign(ns, idx) { return this.wallet.signMessage(`vault-web3:kek:v1:${ns}:${idx}`); }
  async deriveKEK(ns, idx = 0) { return deriveKEKFromSignature(await this.sign(ns, idx), ns, idx); }
  async collectThresholdShare(ns, idx = 0) { return { signer: this.wallet.address, signature: await this.sign(ns, idx), derivationPath: "m/44'/60'/0'/0/0" }; }
  async getEthersSigner() { return this.tx; }   // one nonce counter per account across writes
}

const config = { trezorManifest: { email: 'e2e@example.com', appUrl: 'http://localhost' }, ipfsApiUrl: IPFS, rpcUrl: RPC, registryAddress: REGISTRY, chainId: Number(process.env.CHAIN_ID || 31337), accountIndex: 0 };
// Defaults are Hardhat's public test accounts. On a public chain, pass a funded OWNER_KEY;
// the stranger can be any key (an unfunded one still can't read or write).
const owner = new SoftwareSigner(process.env.OWNER_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');   // Hardhat test account #0
const stranger = new SoftwareSigner(process.env.STRANGER_KEY || '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'); // Hardhat test account #1
const vault = new VaultClient(config, owner);
const path = `prod/db/credentials-${Date.now().toString(36)}`;   // fresh path, so the run can be repeated on the same chain
const secret = { username: 'app', password: 'S3cure-' + ethers.hexlify(ethers.randomBytes(8)).slice(2) };

console.log(C.h(`\nvault-web3 · end-to-end on ${RPC.includes('127.0.0.1') ? 'a local chain + IPFS node' : RPC + ' + ' + IPFS}`));
console.log(C.dim('signer: software key standing in for the Trezor (same EIP-191 message)\n'));

const health = await vault.healthCheck();
console.log(`${C.y('health')}  ipfs ${health.ipfs.version} · chain ${health.chain.chainId} · block ${health.chain.blockNumber} · signer ${health.signer.address.slice(0, 10)}…`);
await pause(1200);

console.log(`\n${C.y('1. write')}  ${path}`);
const w1 = await vault.write({ path, data: secret });
console.log(`  KEK = HKDF(signature) → wrap DEK → encrypt payload`);
console.log(`  IPFS CID  ${w1.cid}`);
console.log(`  tx        ${w1.txHash.slice(0, 20)}…  version ${w1.version}`);
check('version 1 recorded on the Diamond', w1.version === 1);
await pause(1500);

console.log(`\n${C.y('2. what is public')}`);
const res = await fetch(`${IPFS}/api/v0/cat?arg=${w1.cid}`, { method: 'POST' });
const blob = await res.text(), env = JSON.parse(blob);
console.log(C.dim(`  envelope keys: ${Object.keys(env).join(', ')}`));
console.log(`  algorithm ${env.algorithm}`);
check('IPFS blob does not contain the password', !blob.includes(secret.password));
await pause(1500);

console.log(`\n${C.y('3. read')}  ${path}`);
const r1 = await vault.read(path);
console.log(`  fetched CID from chain → envelope from IPFS → KEK → decrypt`);
check('decrypted secret matches what was written', JSON.stringify(r1.data) === JSON.stringify(secret));
await pause(1500);

console.log(`\n${C.y('4. rotate')}`);
const w2 = await vault.write({ path, data: { ...secret, password: secret.password + '-v2' } });
const versions = await vault.listVersions(path);
console.log(`  version ${w2.version} · CID ${w2.cid.slice(0, 18)}…`);
check('version history has 2 entries', versions.length === 2);
const old = await vault.read(path, 1);
check('version 1 still decrypts', old.data.password === secret.password);
await pause(1500);

console.log(`\n${C.y('5. wrong key')}`);
const strangerVault = new VaultClient(config, stranger);
let denied = false; try { await strangerVault.read(path); } catch { denied = true; }
check('another wallet cannot decrypt', denied);
let blocked = false; try { await strangerVault.write({ path, data: { x: '1' } }); } catch { blocked = true; }
check('another wallet cannot record a version', blocked);
await pause(1500);

console.log(`\n${C.y('6. audit')}`);
const audit = await vault.getAuditLog(path);
console.log(`  ${audit.length} on-chain audit entries for ${path}`);
check('writes appear in the audit log', audit.length >= 2);
await pause(1000);

{
  console.log(`\n${C.y('7. guessing attack')}`);
  const guess = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(secret)));
  const hex = [...new Uint8Array(guess)].map(b => b.toString(16).padStart(2, '0')).join('');
  check('a correct guess does not match the public integrity tag', hex !== env.plaintextHash);
}

console.log(failed ? C.bad(`\n${failed} check(s) failed\n`) : C.ok('\nall checks passed\n'));
process.exit(failed ? 1 : 0);
