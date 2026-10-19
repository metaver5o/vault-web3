/**
 * Networks the hosted vault knows about. The registry address for each comes from
 * deployments.json, which the contracts' deploy script writes for public networks.
 */

import deployments from "../deployments.json";

export interface NetworkPreset {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorer?: string;
  testnet?: boolean;
  faucet?: string;
  currency: { name: string; symbol: string; decimals: number };
}

export const NETWORKS: Record<number, NetworkPreset> = {
  84532: {
    chainId: 84532, name: "Base Sepolia", rpcUrl: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org", testnet: true,
    faucet: "https://docs.base.org/base-chain/tools/network-faucets",
    currency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  },
  8453: {
    chainId: 8453, name: "Base", rpcUrl: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  31337: {
    chainId: 31337, name: "Local (Hardhat)", rpcUrl: "http://127.0.0.1:8545", testnet: true,
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
};

/** Networks offered in the switcher, in order. */
export const HOSTED_NETWORKS = [84532, 8453];

/** Public IPFS write endpoint used by the hosted UI (a Worker that pins to Pinata). */
export const PUBLIC_IPFS_API = "https://ipfs.criptografia.app";

export const servedLocally = () =>
  typeof window !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

export function registryFor(chainId: number | null | undefined): string | null {
  if (!chainId) return null;
  return (deployments as Record<string, { registry?: string }>)[String(chainId)]?.registry ?? null;
}

export function networkName(chainId: number | null | undefined): string {
  if (!chainId) return "Unknown network";
  return NETWORKS[chainId]?.name ?? `Chain ${chainId}`;
}

/** Ask the wallet to switch to a network, adding it first if the wallet doesn't know it. */
export async function switchNetwork(chainId: number): Promise<void> {
  const eth = (window as { ethereum?: { request(a: { method: string; params?: unknown[] }): Promise<unknown> } }).ethereum;
  if (!eth) throw new Error("No browser wallet found.");
  const hex = `0x${chainId.toString(16)}`;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (err) {
    const n = NETWORKS[chainId];
    if ((err as { code?: number })?.code !== 4902 || !n) throw err;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hex, chainName: n.name, rpcUrls: [n.rpcUrl], nativeCurrency: n.currency, blockExplorerUrls: n.explorer ? [n.explorer] : [] }],
    });
  }
}
