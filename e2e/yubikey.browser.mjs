// YubiKey path in a real browser: Chrome's virtual FIDO2 authenticator (CTAP2, PRF) stands in for the key.
// Needs the stack running (chain + IPFS with CORS), the contracts deployed and the UI served (npm run preview in packages/ui).
// window.ethereum is a thin EIP-1193 shim over the Hardhat node for the registry transactions.
import puppeteer from 'puppeteer-core';
import os from 'os';
import path from 'path';
import fs from 'fs';
const UI = process.env.UI_URL || 'http://localhost:4173', REGISTRY = process.env.REGISTRY;
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'vault-web3-yubikey-'));
const CHROME = process.env.CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545', IPFS = process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
if (!REGISTRY) { console.error('set REGISTRY to the Diamond address printed by the deploy script'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? '✔' : '✘'} ${name}`); if (!ok) failed++; };

async function open(profile, prf) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new', userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), profile)), args: ['--no-first-run'], defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.evaluateOnNewDocument((registry, rpcUrl, ipfsUrl) => {
    localStorage.setItem('vault-web3-config', JSON.stringify({ rpcUrl: rpcUrl, registryAddress: registry, chainId: 31337, ipfsApiUrl: ipfsUrl, accountIndex: 0 }));
    let id = 0;
    const rpc = async (method, params = []) => {
      const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
      const j = await r.json(); if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code }); return j.result;
    };
    window.ethereum = { isMetaMask: true, request: ({ method, params }) => rpc(method === 'eth_requestAccounts' ? 'eth_accounts' : method, params).then(r => method.endsWith('ccounts') ? r.slice(0, 1) : r), on() {}, removeListener() {} };
  }, REGISTRY, RPC, IPFS);
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'usb', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, hasPrf: prf, automaticPresenceSimulation: true } });
  return { browser, page, cdp, authenticatorId };
}

const btn = (page, re) => page.evaluateHandle((src) => [...document.querySelectorAll('button')].find(b => new RegExp(src, 'i').test(b.textContent.trim())), re.source).then(h => h.asElement());
const text = (page) => page.evaluate(() => document.body.innerText);
const go = (page, p) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, p).then(() => sleep(900));
const fill = async (page, ph, v, nth = 0) => { const el = (await page.$$(`[placeholder="${ph}"]`))[nth]; await el.click({ clickCount: 3 }); await el.type(v); };

// 1. A key with PRF: register, connect, write, read.
{
  const { browser, page, cdp, authenticatorId } = await open('vw3-yk-ok-', true);
  await page.goto(UI, { waitUntil: 'networkidle0' });
  check('connect page shows a YubiKey option', /YubiKey/.test(await text(page)) && /Not registered/.test(await text(page)));
  await page.screenshot({ path: `${OUT}/y1-connect.png` });
  await (await btn(page, /^YubiKey/)).click();
  await page.waitForFunction(() => /Yubikey/i.test(document.querySelector('aside, nav')?.innerText || document.body.innerText) && !/Choose your signing method/.test(document.body.innerText), { timeout: 20000 });
  const creds = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
  check('registration created one credential on the key', creds.length === 1);
  check('connected as yubikey', /yubikey/i.test(await text(page)));

  await go(page, '/secrets/write');
  await fill(page, 'secret/myapp/db', 'secret/yubi/api');
  await fill(page, 'key', 'token'); await fill(page, 'value', 'yk-demo-only');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => /secret stored/i.test(document.body.innerText) || /error|failed/i.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
  check('write with the YubiKey succeeds', /secret stored/i.test(await text(page)));
  await page.screenshot({ path: `${OUT}/y2-stored.png` });

  await go(page, '/secrets/read');
  await fill(page, 'secret/myapp/db', 'secret/yubi/api');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /^decrypt$/i.test(b.textContent.trim()) && !b.disabled), { timeout: 15000 });
  await (await btn(page, /^decrypt$/)).click();
  await page.waitForFunction(() => /token/.test(document.querySelector('main')?.innerText || '') && /version/i.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
  const hidden = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /show all/i.test(b.textContent)));
  if (hidden.asElement()) await hidden.asElement().click();
  await sleep(600);
  check('read with the YubiKey decrypts the secret', /yk-demo-only/.test(await text(page)));
  await page.screenshot({ path: `${OUT}/y3-read.png` });

  // A different key (new credential, different PRF secret) can't read it.
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'usb', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  await (await btn(page, /^decrypt$/)).click();
  await sleep(4000);
  check('another key cannot decrypt (no credential → error)', !/yk-demo-only/.test(await page.evaluate(() => document.querySelector('main')?.innerText || '')) || /error|not|fail/i.test(await text(page)));
  await browser.close();
}

// 2. A key without PRF: the how-to shows up.
{
  const { browser, page } = await open('vw3-yk-noprf-', false);
  await page.goto(UI, { waitUntil: 'networkidle0' });
  await (await btn(page, /^YubiKey/)).click();
  await page.waitForSelector('#connect-error', { timeout: 20000 });
  const t = await text(page);
  check('key without PRF gets a how-to', /How to fix/.test(t) && /ykman info|firmware/i.test(t));
  check('how-to links the setup guide', /YubiKey setup guide/.test(t));
  await page.screenshot({ path: `${OUT}/y4-howto.png` });
  await browser.close();
}

console.log(failed ? `${failed} check(s) failed` : 'all YubiKey checks passed');
process.exit(failed ? 1 : 0);

