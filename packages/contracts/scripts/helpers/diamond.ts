import { ethers, type BaseContract } from "ethers";

export enum FacetCutAction {
  Add = 0,
  Replace = 1,
  Remove = 2,
}

/**
 * Get all function selectors from a deployed contract's interface.
 * Excludes the constructor and any selectors that would conflict.
 */
export function getSelectors(contract: BaseContract): string[] {
  const iface = contract.interface;
  const selectors: string[] = [];
  for (const fragment of iface.fragments) {
    if (fragment.type === "function") {
      selectors.push(iface.getFunction(fragment.name)!.selector);
    }
  }
  return selectors;
}

/**
 * Remove selectors from an array (used when replacing facets).
 */
export function removeSelectors(
  selectors: string[],
  signatures: string[]
): string[] {
  const iface = new ethers.Interface(signatures.map((s) => `function ${s}`));
  const removeSet = new Set(
    signatures.map((s) => iface.getFunction(s)!.selector)
  );
  return selectors.filter((s) => !removeSet.has(s));
}
