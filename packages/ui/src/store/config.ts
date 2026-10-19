/**
 * Client-side config store backed by localStorage.
 * Mirrors the CLI's conf store but for browser context.
 */

export interface UIConfig {
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
    return { ...DEFAULTS, ...JSON.parse(raw) };
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
