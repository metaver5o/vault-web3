# Deploying the hosted vault

The hosted UI at [vault.criptografia.app](https://vault.criptografia.app) needs three public pieces. None of them ever sees a secret: envelopes are encrypted in the browser before they leave it.

| Piece | Where | What it does |
|---|---|---|
| UI | GitHub Pages | Built and published by `.github/workflows/pages.yml` on every push to `main` |
| Registry contract | Base Sepolia and Base | Records CID versions, roles and the audit log. The UI follows the wallet's network |
| IPFS endpoint | Cloudflare Worker at `ipfs.criptografia.app` | Accepts vault envelopes only and pins them to Pinata |

## 1. Pinata key

1. Create a Pinata account and go to **API Keys → New Key**.
2. Make it a **scoped key with only `pinFileToIPFS`** (Legacy endpoints → Pinning). Nothing else.
3. Copy the **JWT**. It goes straight into Cloudflare in the next step; don't save it anywhere else.

## 2. IPFS Worker

```bash
cd workers/ipfs
npm install
npx wrangler login                    # opens the browser; pick the account that has criptografia.app
npx wrangler secret put PINATA_JWT    # paste the JWT when asked
npx wrangler deploy                   # also creates the ipfs.criptografia.app DNS record
```

Check it: `curl -X POST https://ipfs.criptografia.app/api/v0/version` should return `vault-web3-ipfs-1`.

Optional: a dedicated Pinata gateway (Pinata → Gateways) makes reads faster. Put its URL in `GATEWAY` in `wrangler.toml` and redeploy.

The Worker refuses anything that isn't a vault envelope under 64 KB, allows only `https://vault.criptografia.app` (and localhost) as browser origins, and limits each IP to 20 writes a minute.

## 3. Registry contracts

Use a fresh wallet for deploying; it becomes the contracts' owner (it can pause the registry and upgrade facets).

```bash
cd packages/contracts
npx hardhat vars set DEPLOYER_PRIVATE_KEY   # paste the key; stored in Hardhat's config dir, not in the repo
```

Fund that address with about **0.001 ETH** on each network (deploying uses ~5.1M gas). Base Sepolia ETH is free from a [faucet](https://docs.base.org/base-chain/tools/network-faucets).

```bash
npx hardhat run scripts/deploy.ts --network baseSepolia
npx hardhat run scripts/deploy.ts --network base
```

Each run writes the registry address to `packages/ui/src/deployments.json`. Commit that file and push: the Pages workflow rebuilds the UI, and the network switcher enables that network.

After deploying to Base mainnet, move ownership to a multisig before anyone stores real secrets (see the threat model).

## How the shared registry works

Anyone can use the hosted vault without asking for access: **the first wallet to write to a path owns it**. It can keep writing and can grant roles on that path to others; nobody else can record versions there. Paths are first come, first served, so use names under your own prefix (for example `secret/<your-name>/...`).
