/**
 * VaultRegistry Diamond integration tests.
 * Run: npx hardhat test
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract, Signer } from "ethers";
import { getSelectors, FacetCutAction } from "../scripts/helpers/diamond";

describe("VaultRegistry Diamond", () => {
  let diamond: Contract;
  let registry: Contract;
  let access: Contract;
  let audit: Contract;
  let owner: Signer;
  let alice: Signer;
  let bob: Signer;

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy DiamondCutFacet
    const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
    const diamondCutFacet = await DiamondCutFacet.deploy();

    // Deploy Diamond
    const Diamond = await ethers.getContractFactory("Diamond");
    diamond = await Diamond.deploy(await owner.getAddress(), await diamondCutFacet.getAddress());

    // Deploy facets
    const facetContracts: { name: string; contract: Contract }[] = [];
    for (const name of ["DiamondLoupeFacet", "VaultRegistryFacet", "AccessControlFacet", "AuditFacet"]) {
      const F = await ethers.getContractFactory(name);
      const f = await F.deploy();
      facetContracts.push({ name, contract: f });
    }

    // Deploy init
    const Init = await ethers.getContractFactory("VaultDiamondInit");
    const init = await Init.deploy();

    // Cut
    const cuts = facetContracts.map(({ contract }) => ({
      facetAddress: contract.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(contract),
    }));

    const diamondCut = await ethers.getContractAt("IDiamondCut", await diamond.getAddress());
    await diamondCut.diamondCut(
      await Promise.all(cuts.map(async (c) => ({ ...c, facetAddress: await c.facetAddress }))),
      await init.getAddress(),
      init.interface.encodeFunctionData("init")
    );

    registry = await ethers.getContractAt("VaultRegistryFacet", await diamond.getAddress());
    access = await ethers.getContractAt("AccessControlFacet", await diamond.getAddress());
    audit = await ethers.getContractAt("AuditFacet", await diamond.getAddress());
  });

  describe("Access Control", () => {
    const PATH = "secret/test/db";

    it("diamond owner has implicit admin access", async () => {
      // Owner can grant roles (onlyAdmin passes for diamond owner)
      await expect(
        access.connect(owner).grantRole(PATH, await alice.getAddress(), 3, 0, false)
      ).to.emit(access, "RoleGranted");
    });

    it("alice has reader role", async () => {
      expect(
        await access.hasRole(PATH, await alice.getAddress(), 3)
      ).to.be.true;
    });

    it("alice does not have writer role", async () => {
      expect(
        await access.hasRole(PATH, await alice.getAddress(), 2)
      ).to.be.false;
    });

    it("non-admin cannot grant roles", async () => {
      await expect(
        access.connect(bob).grantRole(PATH, await bob.getAddress(), 3, 0, false)
      ).to.be.revertedWith("AccessControl: caller lacks Admin role");
    });

    it("revoking a role removes access", async () => {
      await access.connect(owner).revokeRole(PATH, await alice.getAddress());
      expect(
        await access.hasRole(PATH, await alice.getAddress(), 3)
      ).to.be.false;
    });
  });

  describe("VaultRegistry", () => {
    const PATH = "secret/test/myapp";
    const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
    const HASH = ethers.keccak256(ethers.toUtf8Bytes("plaintext-hash"));

    before(async () => {
      // Grant writer to alice
      await access.connect(owner).grantRole(PATH, await alice.getAddress(), 2, 0, false);
    });

    it("writer can record a version", async () => {
      await expect(
        registry.connect(alice).recordSecretVersion(PATH, CID, HASH)
      )
        .to.emit(registry, "SecretVersionRecorded")
        .withArgs(PATH, PATH, 1n, CID, await alice.getAddress(), (n: bigint) => n > 0n);
    });

    it("latest version is 1 after first write", async () => {
      expect(await registry.getLatestVersion(PATH)).to.equal(1n);
    });

    it("can retrieve the stored version", async () => {
      const v = await registry.getSecretVersion(PATH, 1);
      expect(v.cid).to.equal(CID);
      expect(v.author).to.equal(await alice.getAddress());
      expect(v.version).to.equal(1n);
    });

    it("non-writer cannot record a version", async () => {
      await expect(
        registry.connect(bob).recordSecretVersion(PATH, CID, HASH)
      ).to.be.revertedWith("VaultRegistry: caller lacks Writer role");
    });

    it("second write increments version", async () => {
      await registry.connect(alice).recordSecretVersion(PATH, CID + "v2", HASH);
      expect(await registry.getLatestVersion(PATH)).to.equal(2n);
    });

    it("getVersionHistory returns all versions", async () => {
      const history = await registry.getVersionHistory(PATH);
      expect(history.length).to.equal(2);
      expect(history[0].version).to.equal(1n);
      expect(history[1].version).to.equal(2n);
    });
  });

  describe("Claiming paths (shared deployment)", () => {
    const CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
    const HASH = ethers.keccak256(ethers.toUtf8Bytes("h"));

    it("first write to an unclaimed path claims it", async () => {
      const P = "secret/bob/api";
      await expect(registry.connect(bob).recordSecretVersion(P, CID, HASH))
        .to.emit(registry, "PathClaimed").withArgs(P, P, await bob.getAddress());
      expect(await registry.getPathOwner(P)).to.equal(await bob.getAddress());
      expect(await access.hasRole(P, await bob.getAddress(), 0)).to.equal(true);
    });

    it("the claimer can keep writing", async () => {
      await registry.connect(bob).recordSecretVersion("secret/bob/api", CID, HASH);
      expect(await registry.getLatestVersion("secret/bob/api")).to.equal(2n);
    });

    it("nobody else can write to a claimed path", async () => {
      await expect(registry.connect(alice).recordSecretVersion("secret/bob/api", CID, HASH))
        .to.be.revertedWith("VaultRegistry: caller lacks Writer role");
    });

    it("the claimer can grant writers on their path", async () => {
      await access.connect(bob).grantRole("secret/bob/api", await alice.getAddress(), 2, 0, false);
      await registry.connect(alice).recordSecretVersion("secret/bob/api", CID, HASH);
      expect(await registry.getLatestVersion("secret/bob/api")).to.equal(3n);
    });

    it("a path an admin set up roles on can't be claimed by a stranger", async () => {
      const P = "secret/team/db";
      await access.connect(owner).grantRole(P, await alice.getAddress(), 2, 0, false);
      await expect(registry.connect(bob).recordSecretVersion(P, CID, HASH))
        .to.be.revertedWith("VaultRegistry: caller lacks Writer role");
    });
  });

  describe("AuditFacet", () => {
    const PATH = "secret/test/myapp";

    it("write operations are recorded in audit log", async () => {
      const entries = await audit.getAuditLog(PATH);
      expect(entries.length).to.be.greaterThan(0);
      // Operation 1 = Write
      expect(entries[0].operation).to.equal(1);
      expect(entries[0].granted).to.be.true;
    });

    it("auditLogLength matches getAuditLog length", async () => {
      const log = await audit.getAuditLog(PATH);
      const len = await audit.auditLogLength(PATH);
      expect(len).to.equal(BigInt(log.length));
    });

    it("paginated audit log works", async () => {
      const [entries, total] = await audit.getAuditLogPaginated(PATH, 0, 1);
      expect(entries.length).to.equal(1);
      expect(total).to.be.greaterThan(0n);
    });
  });

  describe("Emergency pause", () => {
    it("owner can pause the registry", async () => {
      await access.connect(owner).setPaused(true);
      const PATH = "secret/test/myapp";
      const HASH = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const [, alice] = await ethers.getSigners();
      await expect(
        registry.connect(alice).recordSecretVersion(PATH, "cid", HASH)
      ).to.be.revertedWith("VaultRegistry: paused");
    });

    it("owner can unpause", async () => {
      await access.connect(owner).setPaused(false);
    });
  });
});
