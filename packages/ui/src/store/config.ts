/**
 * Client-side config store backed by localStorage.
 * Mirrors the CLI's conf store but for browser context.
 */

import { NETWORKS, PUBLIC_IPFS_API, registryFor, servedLocally } from "./networks.ts";

export interface UIConfig {
  /** auto: follow the wallet's network (presets + deployments.json). custom: use the values below. */
  networkMode: "auto" | "custom";
  signerType: "trezor" | "metamask";
  rpcUrl: string;
  registryAddress: string;
  chainId: number;
  ipfsApiUrl: string;
  accountIndex: number;
  defaultNamespace: string;
  qshaasApiKey: string;
  qshaasApiUrl: string;
  useQuantumSeedByDefault: boolean;
}

const DEFAULTS: UIConfig = {
  networkMode: "auto",
  signerType: "metamask",
  rpcUrl: "http://localhost:8545",
  registryAddress: "0x0000000000000000000000000000000000000000",
  chainId: 31337,
  ipfsApiUrl: "http://localhost:5001",
  accountIndex: 0,
  defaultNamespace: "secret",
  qshaasApiKey: "",
  qshaasApiUrl: "https://api.criptografia.net",
  useQuantumSeedByDefault: false,
};

const KEY = "vault-web3-config";

export function loadConfig(): UIConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw);
    // Configs saved before networkMode existed, with a registry filled in, were set up by hand.
    if (!saved.networkMode) saved.networkMode = saved.registryAddress && !/^0x0+$/.test(saved.registryAddress) ? "custom" : "auto";
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(cfg: UIConfig): void {
  localStorage.setItem(KEY, JSON.stringify(cfg));
  // Dispatch a same-tab event (native 'storage' only fires on OTHER tabs)
  window.dispatchEvent(new CustomEvent("vault-config-saved", { detail: cfg }));
}

export function patchConfig(patch: Partial<UIConfig>): UIConfig {
  const current = loadConfig();
  const next = { ...current, ...patch };
  saveConfig(next);
  return next;
}

/**
 * The settings the vault actually uses for a wallet on `walletChainId`.
 * In auto mode the network comes from the wallet; the registry from deployments.json.
 * registryAddress stays zero when vault-web3 isn't deployed on that chain.
 */
export function effectiveConfig(walletChainId: number | null | undefined): UIConfig {
  const cfg = loadConfig();
  if (cfg.networkMode === "custom" || !walletChainId) return cfg;
  const preset = NETWORKS[walletChainId];
  return {
    ...cfg,
    chainId: walletChainId,
    rpcUrl: preset?.rpcUrl ?? cfg.rpcUrl,
    registryAddress: registryFor(walletChainId) ?? "0x0000000000000000000000000000000000000000",
    ipfsApiUrl: servedLocally() && walletChainId === 31337 ? cfg.ipfsApiUrl : PUBLIC_IPFS_API,
  };
}
