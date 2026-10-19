#!/usr/bin/env node
/**
 * vault-web3 CLI
 *
 * Compatible with HashiCorp Vault CLI patterns:
 *   vault-web3 write secret/myapp/db password=xxx key2=val2
 *   vault-web3 read  secret/myapp/db
 *   vault-web3 list  secret/myapp/
 *   vault-web3 delete secret/myapp/db
 *   vault-web3 policy attach secret/myapp/db --address 0x... --role reader
 *   vault-web3 policy detach secret/myapp/db --address 0x...
 *   vault-web3 audit  secret/myapp/db
 *   vault-web3 versions secret/myapp/db
 *   vault-web3 config set rpcUrl http://...
 *   vault-web3 status
 */

import { Command } from "commander";
import ora from "ora";
import { VaultClient } from "@web3-vault/core";
import { getConfig, setConfig, getConfigPath } from "./config.js";
import {
  printSuccess,
  printError,
  printWarning,
  printTrezorPrompt,
  printSecret,
  printVersionHistory,
  printAuditLog,
  type OutputFormat,
} from "./output.js";

const program = new Command();

program
  .name("vault-web3")
  .description("Decentralized secrets vault with Trezor hardware root of trust")
  .version("0.1.0")
  .option("-f, --format <format>", "Output format: json|table|raw", "table")
  .option("-n, --namespace <ns>", "Override default namespace");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createClient(): VaultClient {
  return new VaultClient(getConfig());
}

function resolvePath(rawPath: string): string {
  // If the user provides "myapp/db" without a namespace prefix,
  // prepend the default namespace
  if (!rawPath.includes("/") || !rawPath.match(/^[a-z]+\//)) {
    const cfg = getConfig();
    return `${cfg.defaultNamespace}/${rawPath}`;
  }
  return rawPath;
}

function parseKVArgs(args: string[]): Record<string, string> {
  const data: Record<string, string> = {};
  for (const arg of args) {
    const eqIdx = arg.indexOf("=");
    if (eqIdx === -1) {
      throw new Error(`Invalid key=value argument: ${arg}`);
    }
    const key = arg.slice(0, eqIdx);
    const value = arg.slice(eqIdx + 1);
    data[key] = value;
  }
  if (Object.keys(data).length === 0) {
    throw new Error("At least one key=value pair is required");
  }
  return data;
}

// ─── write ────────────────────────────────────────────────────────────────────

program
  .command("write <path> [data...]")
  .description("Write a secret (key=value pairs)")
  .option("-d, --derivation-index <n>", "KEK derivation index (for key rotation)", "0")
  .action(async (rawPath: string, dataArgs: string[], opts) => {
    const format = program.opts().format as OutputFormat;
    const path = resolvePath(rawPath);
    let data: Record<string, string>;
    try {
      data = parseKVArgs(dataArgs);
    } catch (err: any) {
      printError(err.message);
      process.exit(1);
    }

    printTrezorPrompt(`Encrypt and store secret at '${path}'`);
    const spinner = ora("Encrypting secret…").start();
    const client = createClient();
    try {
      const result = await client.write({
        path,
        data,
        derivationIndex: parseInt(opts.derivationIndex, 10),
      });
      spinner.succeed("Secret stored");
      if (format === "json") {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printSuccess(`Written to ${path} (version ${result.version})`);
        printSuccess(`CID: ${result.cid}`);
        printSuccess(`Tx: ${result.txHash}`);
      }
    } catch (err: any) {
      spinner.fail();
      printError(err.message);
      process.exit(1);
    } finally {
      client.dispose();
    }
  });

// ─── read ─────────────────────────────────────────────────────────────────────

program
  .command("read <path>")
  .description("Read and decrypt a secret")
  .option("-v, --version <n>", "Read a specific version")
  .action(async (rawPath: string, opts) => {
    const format = program.opts().format as OutputFormat;
    const path = resolvePath(rawPath);

    printTrezorPrompt(`Decrypt secret at '${path}'`);
    const spinner = ora("Fetching and decrypting…").start();
    const client = createClient();
    try {
      const version = opts.version ? parseInt(opts.version, 10) : undefined;
      const result = await client.read(path, version);
      spinner.succeed("Decrypted");
      if (format === "json") {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printSecret(result.data, format);
      }
    } catch (err: any) {
      spinner.fail();
      printError(err.message);
      process.exit(1);
    } finally {
      client.dispose();
    }
  });

// ─── delete ───────────────────────────────────────────────────────────────────

program
  .command("delete <path>")
  .description("Soft-delete a secret (records tombstone, history preserved on-chain)")
  .action(async (rawPath: string) => {
    const path = resolvePath(rawPath);
    printWarning(`This records a tombstone for '${path}'. History is immutable.`);
    printTrezorPrompt(`Delete secret at '${path}'`);
    const spinner = ora("Deleting…").start();
    const client = createClient();
    try {
      await client.delete(path);
      spinner.succeed(`Tombstone recorded for ${path}`);
    } catch (err: any) {
      spinner.fail();
      printError(err.message);
      process.exit(1);
    } finally {
      client.dispose();
    }
  });

// ─── versions ────────────────────────────────────────────────────────────────

program
  .command("versions <path>")
  .description("List all versions of a secret")
  .action(async (rawPath: string) => {
    const format = program.opts().format as OutputFormat;
    const path = resolvePath(rawPath);
    const client = createClient();
    try {
      const versions = await client.listVersions(path);
      printVersionHistory(versions, format);
    } catch (err: any) {
      printError(err.message);
      process.exit(1);
    } finally {
      client.dispose();
    }
  });

// ─── policy ───────────────────────────────────────────────────────────────────

const policy = program.command("policy").description("Manage access control policies");

policy
  .command("attach <path>")
  .description("Grant a role to an Ethereum address")
  .requiredOption("--address <addr>", "Ethereum address of the grantee")
  .requiredOption("--role <role>", "Role: owner|admin|writer|reader")
  .option("--expires <timestamp>", "Unix timestamp when the role expires (0 = never)", "0")
  .option("--multisig", "Require multi-sig approval for sensitive operations")
  .action(async (rawPath: string, opts) => {
    const path = resolvePath(rawPath);
    const validRoles = ["owner", "admin", "writer", "reader"];
    if (!validRoles.includes(opts.role)) {
      printError(`Invalid role '${opts.role}'. Must be one of: ${validRoles.join(", ")}`);
      process.exit(1);
    }
    printTrezorPrompt(`Grant role '${opts.role}' on '${path}' to ${opts.address}`);
    const spinner = ora("Submitting on-chain tx…").start();
    const client = createClient();
    try {
      const txHash = await client.grantRole(path, opts.address, opts.role as any, {
        expiresAt: parseInt(opts.expires, 10),
        multiSigRequired: !!opts.multisig,
      });
      spinner.succeed(`Role granted. Tx: ${txHash}`);
    } catch (err: any) {
      spinner.fail();
      printError(err.message);
      process.exit(1);
    } finally {
      client.dispose();
    }
  });

policy
  .command("detach <path>")
  .description("Revoke a role from an Ethereum address")
  .requiredOption("--address <addr>", "Ethereum address")
  .action(async (rawPath: string, opts) => {
    const path = resolvePath(rawPath);
    printTrezorPrompt(`Revoke role on '${path}' from ${opts.address}`);
    const spinner = ora("Submitting on-chain tx…").start();
    const client = createClient();
    try {
      const txHash = await client.revokeRole(path, opts.address);
      spinner.succeed(`Role revoked. Tx: ${txHash}`);
    } catch (err: any) {
      spinner.fail();
      printError(err.message);
      process.exit(1);
    } finally {
      client.dispose();
    }
  });

policy
  .command("check <path>")
  .description("Check if an address has a role")
  .requiredOption("--address <addr>", "Ethereum address")
  .requiredOption("--role <role>", "Role to check")
  .action(async (rawPath: string, opts) => {
    const path = resolvePath(rawPath);
    const client = createClient();
    try {
      const has = await client.checkAccess(path, opts.address, opts.role as any);
      if (has) {
        printSuccess(`${opts.address} has role '${opts.role}' on '${path}'`);
      } else {
        printWarning(`${opts.address} does NOT have role '${opts.role}' on '${path}'`);
        process.exit(1);
      }
    } catch (err: any) {
      printError(err.message);
      process.exit(1);
    } finally {
      client.dispose();
    }
  });

// ─── audit ────────────────────────────────────────────────────────────────────

program
  .command("audit <path>")
  .description("Show on-chain audit log for a secret path")
  .option("--from-block <n>", "Start block number", "0")
  .action(async (rawPath: string, opts) => {
    const format = program.opts().format as OutputFormat;
    const path = resolvePath(rawPath);
    const client = createClient();
    try {
      const log = await client.getAuditLog(path, parseInt(opts.fromBlock, 10));
      if (log.length === 0) {
        printWarning("No audit log entries found");
      } else {
        printAuditLog(log, format);
      }
    } catch (err: any) {
      printError(err.message);
      process.exit(1);
    } finally {
      client.dispose();
    }
  });

// ─── config ───────────────────────────────────────────────────────────────────

const config = program.command("config").description("Manage vault-web3 configuration");

config
  .command("set <key> <value>")
  .description("Set a configuration value")
  .action((key: string, value: string) => {
    setConfig(key as any, value);
    printSuccess(`Set ${key} = ${value}`);
    printSuccess(`Config saved to: ${getConfigPath()}`);
  });

config
  .command("get [key]")
  .description("Show configuration (or a specific key)")
  .action((key?: string) => {
    const cfg = getConfig();
    if (key) {
      console.log((cfg as any)[key]);
    } else {
      console.log(JSON.stringify(cfg, null, 2));
    }
  });

config
  .command("path")
  .description("Show config file path")
  .action(() => {
    console.log(getConfigPath());
  });

// ─── status ───────────────────────────────────────────────────────────────────

program
  .command("status")
  .description("Check connectivity (IPFS, chain RPC, Trezor)")
  .action(async () => {
    const format = program.opts().format as OutputFormat;
    const spinner = ora("Checking status…").start();
    const client = createClient();
    try {
      const status = await client.healthCheck();
      spinner.succeed("All systems operational");
      if (format === "json") {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`  IPFS    : ${status.ipfs.id} (${status.ipfs.version})`);
        console.log(`  Chain   : block ${status.chain.blockNumber} (chainId ${status.chain.chainId})`);
        console.log(`  Signer  : ${status.signer.type} ${status.signer.address}`);
      }
    } catch (err: any) {
      spinner.fail();
      printError(err.message);
      process.exit(1);
    } finally {
      client.dispose();
    }
  });

program.parse(process.argv);
