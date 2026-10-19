// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LibVaultStorage} from "../libraries/LibVaultStorage.sol";
import {LibDiamond} from "../diamond/LibDiamond.sol";

/**
 * @title VaultRegistryFacet
 * @notice Records secret versions (IPFS CIDs) on-chain with immutable audit trail.
 *
 * Every write appends a new version — there is no update or delete at the
 * storage level. Tombstones are represented as a new version with a sentinel
 * CID ("deleted").
 *
 * Access control: caller must have at least Writer role for the path.
 *
 * GAS NOTE: String storage is expensive on mainnet. For production L1 deployment,
 * consider emitting the CID as an event only (off-chain indexer picks it up)
 * and storing only a keccak256 commitment on-chain. For L2 (zkSync/Polygon zkEVM)
 * calldata is cheap enough that full string storage is acceptable.
 */
contract VaultRegistryFacet {
    using LibVaultStorage for LibVaultStorage.VaultStorage;

    event SecretVersionRecorded(
        string indexed pathIndexed,   // keccak256-indexed for filtering
        string path,                  // full path string in event data
        uint256 version,
        string cid,
        address author,
        uint256 timestamp
    );

    modifier notPaused() {
        require(!LibVaultStorage.getStorage().paused, "VaultRegistry: paused");
        _;
    }

    modifier onlyWriter(string calldata path) {
        require(
            msg.sender == LibDiamond.contractOwner() ||
            LibVaultStorage.hasRole(LibVaultStorage.getStorage(), path, msg.sender, LibVaultStorage.Role.Writer),
            "VaultRegistry: caller lacks Writer role"
        );
        _;
    }

    /**
     * @notice Record a new version of a secret.
     * @param path       The secret path, e.g. "secret/myapp/db"
     * @param cid        IPFS CIDv1 of the encrypted envelope
     * @param plaintextHash keccak256 of the plaintext (verified client-side after decrypt)
     * @return newVersion The version number assigned to this write
     */
    function recordSecretVersion(
        string calldata path,
        string calldata cid,
        bytes32 plaintextHash
    )
        external
        notPaused
        onlyWriter(path)
        returns (uint256 newVersion)
    {
        LibVaultStorage.VaultStorage storage vs = LibVaultStorage.getStorage();
        bytes32 key = LibVaultStorage.pathKey(path);

        newVersion = vs.latestVersion[key] + 1;
        vs.latestVersion[key] = newVersion;

        vs.versions[key][newVersion] = LibVaultStorage.SecretVersion({
            version: newVersion,
            cid: cid,
            plaintextHash: plaintextHash,
            timestamp: block.timestamp,
            author: msg.sender,
            exists: true
        });

        // Append audit entry
        vs.auditLog[key].push(LibVaultStorage.AuditEntry({
            accessor: msg.sender,
            operation: LibVaultStorage.Operation.Write,
            granted: true,
            timestamp: block.timestamp
        }));

        emit SecretVersionRecorded(path, path, newVersion, cid, msg.sender, block.timestamp);
    }

    /**
     * @notice Get a specific version of a secret.
     */
    function getSecretVersion(string calldata path, uint256 version)
        external
        view
        returns (LibVaultStorage.SecretVersion memory)
    {
        LibVaultStorage.VaultStorage storage vs = LibVaultStorage.getStorage();
        bytes32 key = LibVaultStorage.pathKey(path);

        // Log read attempt (NOTE: cannot emit events from view functions;
        // read access logging happens via the API layer off-chain for view calls)
        LibVaultStorage.SecretVersion storage v = vs.versions[key][version];
        require(v.exists, "VaultRegistry: version does not exist");
        return v;
    }

    /**
     * @notice Get the latest version number for a path (0 = never written).
     */
    function getLatestVersion(string calldata path)
        external
        view
        returns (uint256)
    {
        bytes32 key = LibVaultStorage.pathKey(path);
        return LibVaultStorage.getStorage().latestVersion[key];
    }

    /**
     * @notice Get full version history for a path.
     * @dev Unbounded loop — use pagination for paths with many versions in production.
     */
    function getVersionHistory(string calldata path)
        external
        view
        returns (LibVaultStorage.SecretVersion[] memory)
    {
        LibVaultStorage.VaultStorage storage vs = LibVaultStorage.getStorage();
        bytes32 key = LibVaultStorage.pathKey(path);
        uint256 latest = vs.latestVersion[key];
        LibVaultStorage.SecretVersion[] memory result = new LibVaultStorage.SecretVersion[](latest);
        for (uint256 i = 1; i <= latest; i++) {
            result[i - 1] = vs.versions[key][i];
        }
        return result;
    }

    /**
     * @notice Paginated version history (use for paths with many versions).
     */
    function getVersionHistoryPaginated(
        string calldata path,
        uint256 fromVersion,
        uint256 pageSize
    ) external view returns (LibVaultStorage.SecretVersion[] memory, uint256 totalVersions) {
        LibVaultStorage.VaultStorage storage vs = LibVaultStorage.getStorage();
        bytes32 key = LibVaultStorage.pathKey(path);
        totalVersions = vs.latestVersion[key];
        uint256 endVersion = fromVersion + pageSize - 1;
        if (endVersion > totalVersions) endVersion = totalVersions;
        uint256 count = endVersion >= fromVersion ? endVersion - fromVersion + 1 : 0;
        LibVaultStorage.SecretVersion[] memory result = new LibVaultStorage.SecretVersion[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = vs.versions[key][fromVersion + i];
        }
        return (result, totalVersions);
    }
}
