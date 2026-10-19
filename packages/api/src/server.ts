/**
 * vault-web3 REST API server.
 *
 * Implements HashiCorp Vault KV v2 schema for drop-in compatibility:
 *   GET    /v1/:mount/data/:path        → read secret
 *   POST   /v1/:mount/data/:path        → write secret
 *   DELETE /v1/:mount/data/:path        → delete secret
 *   GET    /v1/:mount/metadata/:path    → list versions
 *   GET    /v1/:mount/subkeys/:path     → list keys
 *   POST   /v1/sys/policies/acl/:name   → create policy
 *   GET    /v1/audit                    → audit log
 *
 * Non-standard extensions (prefixed /v1/web3/):
 *   GET    /v1/web3/health              → system health check
 *   GET    /v1/web3/versions/:path      → on-chain version history
 */

import Fastify, { type FastifyRequest, type FastifyReply, type FastifyError } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { VaultClient } from "@web3-vault/core";
import type { VaultConfig } from "@web3-vault/core";

// ─── Config ───────────────────────────────────────────────────────────────────

function getVaultConfig(): VaultConfig {
  return {
    trezorManifest: {
      email: process.env.TREZOR_MANIFEST_EMAIL ?? "vault-api@example.com",
      appUrl: process.env.TREZOR_MANIFEST_URL ?? "http://localhost:3000",
    },
    ipfsApiUrl: process.env.IPFS_API_URL ?? "http://127.0.0.1:5001",
    rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
    registryAddress: process.env.REGISTRY_ADDRESS ?? "0x0000000000000000000000000000000000000000",
    chainId: parseInt(process.env.CHAIN_ID ?? "31337", 10),
    accountIndex: parseInt(process.env.TREZOR_ACCOUNT_INDEX ?? "0", 10),
  };
}

// ─── Fastify server ───────────────────────────────────────────────────────────

const server = Fastify({
  logger: process.env.NODE_ENV === "development" ? {
    level: process.env.LOG_LEVEL ?? "info",
    transport: {
      target: "pino-pretty",
      options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" }
    }
  } : true,
});

await server.register(cors, {
  origin: process.env.CORS_ORIGIN ?? false,
});
await server.register(helmet);
await server.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

// ─── Client lifecycle ─────────────────────────────────────────────────────────

// DESIGN NOTE: VaultClient is stateless per-request because each request
// triggers a Trezor interaction. We do not cache the client across requests
// to avoid holding the Trezor connection open.
function makeClient(): VaultClient {
  return new VaultClient(getVaultConfig());
}

// ─── Schema ────────────────────────────────────────────────────────────────────

const WriteSecretBody = z.object({
  data: z.record(z.string()),
  options: z.object({
    cas: z.number().optional(),
    derivation_index: z.number().optional(),
  }).optional(),
});

const GrantRoleBody = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  role: z.enum(["owner", "admin", "writer", "reader"]),
  expires_at: z.number().optional(),
  multi_sig_required: z.boolean().optional(),
});

// ─── Response helpers ─────────────────────────────────────────────────────────

function kvV2ReadResponse(data: Record<string, string>, metadata: any) {
  return {
    request_id: crypto.randomUUID(),
    lease_id: "",
    renewable: false,
    lease_duration: 0,
    data: {
      data,
      metadata: {
        created_time: new Date(metadata.createdAt).toISOString(),
        custom_metadata: null,
        deletion_time: "",
        destroyed: false,
        version: metadata.version,
      },
    },
    wrap_info: null,
    warnings: null,
    auth: null,
  };
}

function kvV2WriteResponse(result: any) {
  return {
    request_id: crypto.randomUUID(),
    data: {
      created_time: new Date(result.timestamp).toISOString(),
      custom_metadata: null,
      deletion_time: "",
      destroyed: false,
      version: result.version,
      cid: result.cid,
      tx_hash: result.txHash,
    },
  };
}

// ─── Routes: KV v2 ────────────────────────────────────────────────────────────

// POST /v1/:mount/data/*path — write
server.post<{ Params: { "*": string; mount: string }; Body: unknown }>(
  "/v1/:mount/data/*",
  async (req, reply) => {
    const path = `${req.params.mount}/${req.params["*"]}`;
    const parsed = WriteSecretBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ errors: parsed.error.errors });
    }
    const client = makeClient();
    try {
      const result = await client.write({
        path,
        data: parsed.data.data,
        derivationIndex: parsed.data.options?.derivation_index,
      });
      return reply.status(200).send(kvV2WriteResponse(result));
    } finally {
      client.dispose();
    }
  }
);

// GET /v1/:mount/data/*path — read
server.get<{
  Params: { "*": string; mount: string };
  Querystring: { version?: string };
}>(
  "/v1/:mount/data/*",
  async (req, reply) => {
    const path = `${req.params.mount}/${req.params["*"]}`;
    const version = req.query.version ? parseInt(req.query.version, 10) : undefined;
    const client = makeClient();
    try {
      const result = await client.read(path, version);
      return reply.status(200).send(kvV2ReadResponse(result.data, result.metadata));
    } catch (err: any) {
      if (err.message?.includes("not found")) {
        return reply.status(404).send({ errors: ["secret not found"] });
      }
      throw err;
    } finally {
      client.dispose();
    }
  }
);

// DELETE /v1/:mount/data/*path — soft delete
server.delete<{ Params: { "*": string; mount: string } }>(
  "/v1/:mount/data/*",
  async (req, reply) => {
    const path = `${req.params.mount}/${req.params["*"]}`;
    const client = makeClient();
    try {
      await client.delete(path);
      return reply.status(204).send();
    } finally {
      client.dispose();
    }
  }
);

// GET /v1/:mount/metadata/*path — version metadata
server.get<{ Params: { "*": string; mount: string } }>(
  "/v1/:mount/metadata/*",
  async (req, reply) => {
    const path = `${req.params.mount}/${req.params["*"]}`;
    const client = makeClient();
    try {
      const versions = await client.listVersions(path);
      return reply.status(200).send({
        request_id: crypto.randomUUID(),
        data: {
          cas_required: false,
          created_time: versions[0]
            ? new Date(versions[0].timestamp * 1000).toISOString()
            : null,
          current_version: versions.length,
          max_versions: 0,
          versions: Object.fromEntries(
            versions.map((v) => [
              v.version,
              {
                created_time: new Date(v.timestamp * 1000).toISOString(),
                deletion_time: "",
                destroyed: false,
                cid: v.cid,
              },
            ])
          ),
        },
      });
    } finally {
      client.dispose();
    }
  }
);

// ─── Routes: Policy (Vault ACL compatible) ────────────────────────────────────

// POST /v1/sys/policies/acl/:name/grant
server.post<{ Params: { name: string }; Body: unknown }>(
  "/v1/sys/policies/acl/:name/grant",
  async (req, reply) => {
    const path = req.params.name;
    const parsed = GrantRoleBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ errors: parsed.error.errors });
    }
    const client = makeClient();
    try {
      const txHash = await client.grantRole(
        path,
        parsed.data.address,
        parsed.data.role,
        {
          expiresAt: parsed.data.expires_at,
          multiSigRequired: parsed.data.multi_sig_required,
        }
      );
      return reply.status(200).send({ tx_hash: txHash });
    } finally {
      client.dispose();
    }
  }
);

// DELETE /v1/sys/policies/acl/:name/revoke
server.delete<{ Params: { name: string }; Querystring: { address: string } }>(
  "/v1/sys/policies/acl/:name/revoke",
  async (req, reply) => {
    const path = req.params.name;
    const { address } = req.query;
    const client = makeClient();
    try {
      const txHash = await client.revokeRole(path, address);
      return reply.status(200).send({ tx_hash: txHash });
    } finally {
      client.dispose();
    }
  }
);

// ─── Routes: Web3 Extensions ──────────────────────────────────────────────────

// GET /v1/web3/health
server.get("/v1/web3/health", async (_req, reply) => {
  const client = makeClient();
  try {
    const status = await client.healthCheck();
    return reply.status(200).send({ status: "ok", ...status });
  } catch (err: any) {
    return reply.status(503).send({ status: "unhealthy", error: err.message });
  } finally {
    client.dispose();
  }
});

// GET /v1/web3/versions/*path
server.get<{ Params: { "*": string } }>(
  "/v1/web3/versions/*",
  async (req, reply) => {
    const path = req.params["*"];
    const client = makeClient();
    try {
      const versions = await client.listVersions(path);
      return reply.status(200).send({ path, versions });
    } finally {
      client.dispose();
    }
  }
);

// GET /v1/web3/audit/*path
server.get<{ Params: { "*": string } }>(
  "/v1/web3/audit/*",
  async (req, reply) => {
    const path = req.params["*"];
    const client = makeClient();
    try {
      const log = await client.getAuditLog(path);
      return reply.status(200).send({ path, log });
    } finally {
      client.dispose();
    }
  }
);

// ─── Global error handler ─────────────────────────────────────────────────────

server.setErrorHandler((error: FastifyError, _req, reply) => {
  server.log.error(error);
  const statusCode = error.statusCode ?? 500;
  return reply.status(statusCode).send({
    errors: [error.message ?? "Internal server error"],
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? "8200", 10); // 8200 = same default as HashiCorp Vault
const host = process.env.HOST ?? "127.0.0.1";

await server.listen({ port, host });
console.log(`vault-web3 API listening on http://${host}:${port}`);
