/**
 * CLI configuration store (~/.config/vault-web3/config.json)
 * Managed via `vault-web3 config set/get`.
 */

import Conf from "conf";
import type { VaultConfig } from "@vault-web3/core";

export interface CLIConfig extends VaultConfig {
  defaultNamespace: string;
}

const DEFAULT_CONFIG: CLIConfig = {
  trezorManifest: {
    email: "user@example.com",
    appUrl: "https://vault-web3.local",
  },
  ipfsApiUrl: "http://127.0.0.1:5001",
  rpcUrl: "http://127.0.0.1:8545",
  registryAddress: "0x0000000000000000000000000000000000000000",
  chainId: 31337, // Hardhat local
  accountIndex: 0,
  defaultNamespace: "secret",
};

const store = new Conf<CLIConfig>({
  projectName: "vault-web3",
  defaults: DEFAULT_CONFIG,
  schema: {
    trezorManifest: { type: "object" },
    ipfsApiUrl: { type: "string" },
    rpcUrl: { type: "string" },
    registryAddress: { type: "string" },
    chainId: { type: "number" },
    accountIndex: { type: "number" },
    defaultNamespace: { type: "string" },
  },
});

export function getConfig(): CLIConfig {
  return store.store;
}

export function setConfig(key: keyof CLIConfig, value: unknown): void {
  store.set(key as string, value);
}

export function getConfigPath(): string {
  return store.path;
}
