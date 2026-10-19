/**
 * Deploy the VaultRegistry Diamond to the configured network.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network localhost
 *   npx hardhat run scripts/deploy.ts --network baseSepolia
 *   npx hardhat run scripts/deploy.ts --network base
 *
 * Public networks are recorded in packages/ui/src/deployments.json, which the
 * hosted UI reads to find the registry for whatever chain the wallet is on.
 */

import fs from "fs";
import path from "path";
import { ethers, network } from "hardhat";
import { getSelectors, FacetCutAction } from "./helpers/diamond";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // 1. Deploy DiamondCutFacet
  const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
  const diamondCutFacet = await DiamondCutFacet.deploy();
  await diamondCutFacet.waitForDeployment();
  console.log("DiamondCutFacet:", await diamondCutFacet.getAddress());

  // 2. Deploy Diamond proxy
  const Diamond = await ethers.getContractFactory("Diamond");
  const diamond = await Diamond.deploy(deployer.address, await diamondCutFacet.getAddress());
  await diamond.waitForDeployment();
  const diamondAddress = await diamond.getAddress();
  console.log("Diamond proxy:", diamondAddress);

  // 3. Deploy all other facets
  const facetNames = [
    "DiamondLoupeFacet",
    "VaultRegistryFacet",
    "AccessControlFacet",
    "AuditFacet",
  ];

  const facetCuts = [];
  for (const facetName of facetNames) {
    const Facet = await ethers.getContractFactory(facetName);
    const facet = await Facet.deploy();
    await facet.waitForDeployment();
    const addr = await facet.getAddress();
    console.log(`${facetName}: ${addr}`);

    facetCuts.push({
      facetAddress: addr,
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(facet),
    });
  }

  // 4. Deploy init contract
  const VaultDiamondInit = await ethers.getContractFactory("VaultDiamondInit");
  const vaultInit = await VaultDiamondInit.deploy();
  await vaultInit.waitForDeployment();
  console.log("VaultDiamondInit:", await vaultInit.getAddress());

  // 5. Execute diamondCut to add all facets + run init
  const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);
  const initCalldata = vaultInit.interface.encodeFunctionData("init");

  const tx = await diamondCut.diamondCut(
    facetCuts,
    await vaultInit.getAddress(),
    initCalldata
  );
  const receipt = await tx.wait(1);
  console.log("Diamond cut complete. Gas used:", receipt?.gasUsed.toString());

  // 6. Verify
  const loupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress);
  const registeredFacets = await loupe.facetAddresses();
  console.log(`\nRegistered ${registeredFacets.length} facets:`);
  for (const addr of registeredFacets) {
    const selectors = await loupe.facetFunctionSelectors(addr);
    console.log(`  ${addr}: ${selectors.length} functions`);
  }

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 31337) {
    const file = path.join(__dirname, "../../ui/src/deployments.json");
    const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    all[chainId] = {
      network: network.name,
      registry: diamondAddress,
      owner: deployer.address,
      block: await ethers.provider.getBlockNumber(),
      deployedAt: new Date().toISOString(),
    };
    fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
    console.log(`Recorded in ${path.relative(process.cwd(), file)}`);
  }

  console.log("\n=== Deployment Complete ===");
  console.log("VaultRegistry Diamond:", diamondAddress);
  console.log("\nAdd to your vault-web3 config:");
  console.log(`  vault-web3 config set registryAddress ${diamondAddress}`);
  console.log(`  vault-web3 config set chainId ${(await ethers.provider.getNetwork()).chainId}`);

  return diamondAddress;
}

main()
  .then((addr) => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
