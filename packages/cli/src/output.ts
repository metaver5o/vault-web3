/**
 * CLI output formatters.
 * Supports --format=json|table|raw for pipeline-friendly output.
 */

import chalk from "chalk";
import { table } from "table";

export type OutputFormat = "json" | "table" | "raw";

export function printSuccess(message: string): void {
  console.error(chalk.green("✓") + " " + message);
}

export function printError(message: string): void {
  console.error(chalk.red("✗") + " " + message);
}

export function printWarning(message: string): void {
  console.error(chalk.yellow("⚠") + " " + message);
}

export function printInfo(message: string): void {
  console.error(chalk.blue("→") + " " + message);
}

export function printTrezorPrompt(action: string): void {
  console.error(
    chalk.yellow("\n[Trezor]") + " Please confirm on your device: " + chalk.bold(action)
  );
}

export function printSecret(
  data: Record<string, string>,
  format: OutputFormat = "table"
): void {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (format === "raw" && Object.keys(data).length === 1) {
    console.log(Object.values(data)[0]);
    return;
  }
  const rows = Object.entries(data).map(([k, v]) => [
    chalk.cyan(k),
    chalk.white(v),
  ]);
  const output = table(
    [[chalk.bold("Key"), chalk.bold("Value")], ...rows],
    {
      border: {
        topBody: "─",
        topJoin: "┬",
        topLeft: "┌",
        topRight: "┐",
        bottomBody: "─",
        bottomJoin: "┴",
        bottomLeft: "└",
        bottomRight: "┘",
        bodyLeft: "│",
        bodyRight: "│",
        bodyJoin: "│",
        joinBody: "─",
        joinLeft: "├",
        joinRight: "┤",
        joinJoin: "┼",
      },
    }
  );
  console.log(output);
}

export function printVersionHistory(
  entries: Array<{
    version: number;
    cid: string;
    author: string;
    timestamp: number;
  }>,
  format: OutputFormat = "table"
): void {
  if (format === "json") {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  const rows = entries.map((e) => [
    String(e.version),
    chalk.cyan(e.cid.slice(0, 20) + "…"),
    chalk.dim(e.author),
    new Date(e.timestamp * 1000).toISOString(),
  ]);
  const output = table(
    [
      [chalk.bold("Ver"), chalk.bold("CID"), chalk.bold("Author"), chalk.bold("Timestamp")],
      ...rows,
    ]
  );
  console.log(output);
}

export function printAuditLog(
  entries: Array<{
    accessor: string;
    path: string;
    operation: string;
    granted: boolean;
    timestamp: number;
  }>,
  format: OutputFormat = "table"
): void {
  if (format === "json") {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  const rows = entries.map((e) => [
    new Date(e.timestamp * 1000).toISOString(),
    chalk.dim(e.accessor.slice(0, 10) + "…"),
    e.operation,
    e.granted ? chalk.green("✓") : chalk.red("✗"),
  ]);
  const output = table([
    [chalk.bold("Time"), chalk.bold("Accessor"), chalk.bold("Op"), chalk.bold("OK")],
    ...rows,
  ]);
  console.log(output);
}
