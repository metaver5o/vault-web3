# Migration Guide: HashiCorp Vault → vault-web3

## Prerequisites

1. HashiCorp Vault running and unsealed (source)
2. vault-web3 stack running (`docker compose up -d`)
3. Contracts deployed (`npm run deploy:contracts`)
4. vault-web3 CLI installed and configured
5. Trezor connected and unlocked

---

## Step 1: Export secrets from HashiCorp Vault

The migration script below recursively exports all KV v2 secrets to a local
encrypted JSON file. **The file is AES-256-GCM encrypted with a password you
provide — never store it unencrypted.**

```typescript
// scripts/export-hvault.ts
// Run: VAULT_ADDR=https://... VAULT_TOKEN=... npx ts-node scripts/export-hvault.ts

import { createCipheriv, randomBytes, scryptSync, createDecipheriv } from "crypto";
import { writeFileSync } from "fs";

const VAULT_ADDR = process.env.VAULT_ADDR ?? "http://127.0.0.1:8200";
const VAULT_TOKEN = process.env.VAULT_TOKEN!;
const EXPORT_PASSWORD = process.env.EXPORT_PASSWORD!;

async function vaultRequest(path: string): Promise<any> {
  const res = await fetch(`${VAULT_ADDR}/v1/${path}`, {
    headers: { "X-Vault-Token": VAULT_TOKEN },
  });
  if (!res.ok) throw new Error(`Vault request failed: ${res.status} ${path}`);
  return res.json();
}

async function listSecrets(mount: string, prefix = ""): Promise<string[]> {
  try {
    const res = await vaultRequest(`${mount}/metadata/${prefix}?list=true`);
    const keys: string[] = res.data?.keys ?? [];
    const all: string[] = [];
    for (const key of keys) {
      if (key.endsWith("/")) {
        all.push(...(await listSecrets(mount, prefix + key)));
      } else {
        all.push(prefix + key);
      }
    }
    return all;
  } catch {
    return [];
  }
}

async function readSecret(mount: string, path: string): Promise<Record<string, string>> {
  const res = await vaultRequest(`${mount}/data/${path}`);
  return res.data?.data ?? {};
}

async function main() {
  const mounts = ["secret"]; // Add all your KV mounts
  const allSecrets: Record<string, Record<string, string>> = {};

  for (const mount of mounts) {
    console.log(`Exporting mount: ${mount}`);
    const paths = await listSecrets(mount);
    console.log(`  Found ${paths.length} secrets`);
    for (const path of paths) {
      const data = await readSecret(mount, path);
      allSecrets[`${mount}/${path}`] = data;
      console.log(`  ✓ ${mount}/${path} (${Object.keys(data).length} keys)`);
    }
  }

  const json = JSON.stringify(allSecrets, null, 2);
  const salt = randomBytes(32);
  const key = scryptSync(EXPORT_PASSWORD, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const output = JSON.stringify({
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
    exportedAt: new Date().toISOString(),
    secretCount: Object.keys(allSecrets).length,
  });

  writeFileSync("vault-export.enc.json", output);
  console.log(`\nExported ${Object.keys(allSecrets).length} secrets to vault-export.enc.json`);
  console.log("Keep this file secure and delete after import!");
}

main().catch(console.error);
```

---

## Step 2: Import into vault-web3

```typescript
// scripts/import-to-web3vault.ts
// Run: EXPORT_PASSWORD=... npx ts-node scripts/import-to-web3vault.ts

import { createDecipheriv, scryptSync } from "crypto";
import { readFileSync } from "fs";
import { VaultClient } from "@vault-web3/core";
import { getConfig } from "../packages/cli/src/config";

const EXPORT_PASSWORD = process.env.EXPORT_PASSWORD!;

function decryptExport(encFile: string, password: string): Record<string, Record<string, string>> {
  const enc = JSON.parse(readFileSync(encFile, "utf8"));
  const salt = Buffer.from(enc.salt, "base64");
  const iv = Buffer.from(enc.iv, "base64");
  const tag = Buffer.from(enc.tag, "base64");
  const data = Buffer.from(enc.data, "base64");
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(json);
}

async function main() {
  const secrets = decryptExport("vault-export.enc.json", EXPORT_PASSWORD);
  const client = new VaultClient(getConfig());
  const paths = Object.keys(secrets);

  console.log(`Importing ${paths.length} secrets into vault-web3`);
  console.log("Each secret requires TWO Trezor confirmations (KEK + tx signing).\n");

  let success = 0;
  let failed = 0;

  for (const [i, path] of paths.entries()) {
    console.log(`[${i + 1}/${paths.length}] ${path}`);
    try {
      const result = await client.write({ path, data: secrets[path] });
      console.log(`  ✓ v${result.version} | CID: ${result.cid.slice(0, 20)}... | tx: ${result.txHash.slice(0, 12)}...`);
      success++;
    } catch (err: any) {
      console.error(`  ✗ FAILED: ${err.message}`);
      failed++;
    }
  }

  client.dispose();
  console.log(`\nImport complete: ${success} succeeded, ${failed} failed`);
  if (failed > 0) {
    console.log("Re-run for failed paths individually using: vault-web3 write <path> key=val ...");
  }
}

main().catch(console.error);
```

---

## Step 3: Verify import

```bash
# Check a specific secret
vault-web3 read secret/myapp/db

# Compare with old Vault output
vault kv get -format=json secret/myapp/db | jq '.data.data'
vault-web3 read secret/myapp/db --format=json | jq '.data'

# Verify on-chain record
vault-web3 versions secret/myapp/db
```

---

## Step 4: Migrate access policies

HashiCorp Vault policies (HCL) map to on-chain roles:

| HCL capability | vault-web3 role |
|---------------|-----------------|
| `read`        | `reader`        |
| `create,update` | `writer`      |
| `delete`      | `writer`        |
| `sudo`        | `admin`         |

```bash
# Example: grant reader role to an Ethereum address
vault-web3 policy attach secret/myapp/db \
  --address 0xYourAddress \
  --role reader

# Time-limited grant (expires in 90 days)
EXPIRES=$(date -d '+90 days' +%s)
vault-web3 policy attach secret/myapp/db \
  --address 0xCIAddress \
  --role writer \
  --expires $EXPIRES

# Multi-sig required for sensitive paths
vault-web3 policy attach secret/prod/master-key \
  --address 0xAdminAddress \
  --role owner \
  --multisig
```

---

## Step 5: Cutover

1. Put old HashiCorp Vault in sealed state: `vault operator seal`
2. Update application configs to point to vault-web3 API (`http://localhost:8200`)
   - The API uses the same KV v2 URL schema — drop-in compatible for most clients
3. Test with a canary application first
4. Delete the encrypted export file: `shred -u vault-export.enc.json`

---

## Compatibility Notes

### HashiCorp Vault SDK / Client Libraries

Most HVault client libraries use the standard HTTP API. vault-web3 implements
the same KV v2 endpoints. For Python:

```python
import hvac

# Works with both HashiCorp Vault and vault-web3 API
client = hvac.Client(url='http://localhost:8200')
# No token needed for vault-web3 (Trezor handles auth per-operation)

# Read
secret = client.secrets.kv.v2.read_secret_version(
    path='myapp/db', mount_point='secret'
)
print(secret['data']['data'])

# Write
client.secrets.kv.v2.create_or_update_secret(
    path='myapp/db', secret={'password': 'newval'}, mount_point='secret'
)
```

### Differences from HashiCorp Vault

| Feature                       | HashiCorp Vault         | vault-web3                        |
|------------------------------|-------------------------|-----------------------------------|
| Token auth                   | Required per request    | Not used; Trezor per operation    |
| Dynamic secrets (DB, AWS)    | Supported               | Not implemented (roadmap)         |
| Transit encryption engine    | Available               | Use Trezor signMessage for transit|
| AppRole/K8s auth             | Supported               | Not implemented                   |
| UI                           | Built-in                | Optional (packages/ui)            |
| Lease renewal                | Automatic               | N/A (no leases)                   |
| Namespace isolation (Ent.)   | Enterprise feature      | Path-prefix based (free)          |
