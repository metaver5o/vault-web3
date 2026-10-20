/**
 * ipfs.criptografia.app: the hosted vault's IPFS endpoint.
 *
 * Speaks the small part of the Kubo RPC API the vault client uses (add, cat,
 * pin/add, pin/rm, id, version), so the app needs no changes beyond its URL.
 * Writes are pinned to Pinata with a key that only this Worker holds.
 *
 * It only accepts vault envelopes: small JSON in the vault's encrypted format.
 * Everything it stores was encrypted in the user's browser; it never sees a secret.
 *
 * Secrets (wrangler secret put): PINATA_JWT
 * Vars (wrangler.toml): ALLOWED_ORIGINS, GATEWAY, MAX_BYTES
 * KV (wrangler.toml): ENVELOPES, a copy of every envelope added here. Public IPFS
 * gateways rate-limit or refuse requests from Workers, so reads come from KV first.
 */

const PEER_ID = "12D3KooWRyQjCT4aej3Li2cr9MGH31rr3PU93sztV2qz8Txyh2Tf"; // identifier only; there is no libp2p node
const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,100})$/;
const ENVELOPE_FIELDS = ["version", "algorithm", "dekIv", "dekTag", "encryptedDek", "dataNonce", "encryptedData", "plaintextHash"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST" && request.method !== "GET") return json({ Message: "method not allowed" }, 405, cors);

    try {
      switch (url.pathname) {
        case "/api/v0/add": return await add(request, env, cors);
        case "/api/v0/cat": return await cat(url, env, ctx, cors);
        case "/api/v0/pin/add":
        case "/api/v0/pin/rm": {
          const cid = url.searchParams.get("arg") ?? "";
          if (!CID_RE.test(cid)) return json({ Message: "invalid cid" }, 400, cors);
          return json({ Pins: [cid] }, 200, cors);   // everything added here is already pinned; we never unpin
        }
        case "/api/v0/id": return json({ ID: PEER_ID, AgentVersion: "vault-web3-ipfs/1", Addresses: [], Protocols: [] }, 200, cors);
        case "/api/v0/version": return json({ Version: "vault-web3-ipfs-1", Commit: "", Repo: "", System: "cloudflare-worker", Golang: "" }, 200, cors);
        case "/": return new Response("vault-web3 IPFS endpoint. Stores encrypted vault envelopes only.\n", { headers: { ...cors, "content-type": "text/plain" } });
        default: return json({ Message: "not supported by this endpoint" }, 404, cors);
      }
    } catch (err) {
      return json({ Message: String(err?.message ?? err) }, 500, cors);
    }
  },
};

async function add(request, env, cors) {
  if (request.method !== "POST") return json({ Message: "use POST" }, 405, cors);
  if (env.ADD_LIMIT) {
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await env.ADD_LIMIT.limit({ key: ip });
    if (!success) return json({ Message: "rate limited: try again in a minute" }, 429, cors);
  }
  const max = Number(env.MAX_BYTES ?? 65536);
  if (Number(request.headers.get("content-length") ?? 0) > max + 4096) return json({ Message: "too large" }, 413, cors);

  const form = await request.formData();
  // Kubo clients send the content as a file part, sometimes without a filename (then it arrives as a string).
  const part = [...form.values()][0];
  if (part === undefined) return json({ Message: "no file in request" }, 400, cors);
  const bytes = typeof part === "string" ? new TextEncoder().encode(part) : new Uint8Array(await part.arrayBuffer());
  if (bytes.length > max) return json({ Message: `envelope larger than ${max} bytes` }, 413, cors);

  let envelope;
  try { envelope = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ Message: "not a vault envelope (not JSON)" }, 400, cors); }
  const missing = ENVELOPE_FIELDS.filter((f) => !(f in envelope));
  if (missing.length || ![1, 2].includes(envelope.version) || !/^[0-9a-f]{64}$/.test(envelope.plaintextHash)) {
    return json({ Message: `not a vault envelope${missing.length ? ` (missing ${missing.join(", ")})` : ""}` }, 400, cors);
  }

  if (!env.PINATA_JWT) return json({ Message: "pinning is not configured" }, 503, cors);
  const up = new FormData();
  up.append("file", new Blob([bytes], { type: "application/json" }), "envelope.json");
  up.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  up.append("pinataMetadata", JSON.stringify({ name: "vault-web3-envelope", keyvalues: { app: "vault-web3", v: String(envelope.version) } }));
  const res = await fetch(`${env.PINATA_API ?? "https://api.pinata.cloud"}/pinning/pinFileToIPFS`, {
    method: "POST", headers: { Authorization: `Bearer ${env.PINATA_JWT}` }, body: up,
  });
  if (!res.ok) return json({ Message: `pinning failed (${res.status})` }, 502, cors);
  const { IpfsHash } = await res.json();
  if (env.ENVELOPES) await env.ENVELOPES.put(IpfsHash, bytes);   // content-addressed: never overwritten with different bytes
  // Kubo answers add with one NDJSON line per file.
  return new Response(JSON.stringify({ Name: "envelope.json", Hash: IpfsHash, Size: String(bytes.length) }) + "\n",
    { headers: { ...cors, "content-type": "application/x-ndjson" } });
}

async function cat(url, env, ctx, cors) {
  const cid = url.searchParams.get("arg") ?? "";
  if (!CID_RE.test(cid)) return json({ Message: "invalid cid" }, 400, cors);

  const cache = caches.default;
  const key = new Request(`https://cache.vault-web3/${cid}`);
  let res = await cache.match(key);
  if (!res && env.ENVELOPES) {
    const stored = await env.ENVELOPES.get(cid, "arrayBuffer");
    if (stored) res = new Response(stored);
  }
  if (!res) {
    const gateways = [env.GATEWAY, "https://gateway.pinata.cloud", "https://ipfs.io"].filter(Boolean);
    for (const g of gateways) {
      const r = await fetch(`${g.replace(/\/$/, "")}/ipfs/${cid}`, { headers: env.GATEWAY_KEY && g === env.GATEWAY ? { "x-pinata-gateway-token": env.GATEWAY_KEY } : {} });
      if (r.ok) {
        const body = await r.arrayBuffer();
        if (body.byteLength > Number(env.MAX_BYTES ?? 65536)) return json({ Message: "not a vault envelope (too large)" }, 413, cors);
        res = new Response(body, { headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
        ctx.waitUntil(cache.put(key, res.clone()));   // content-addressed: never changes
        break;
      }
    }
    if (!res) return json({ Message: "not found on IPFS yet; try again shortly" }, 404, cors);
  }
  return new Response(res.body, { headers: { ...cors, "content-type": "application/octet-stream" } });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "access-control-allow-origin": ok ? origin : allowed[0] ?? "",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json" } });
}
