// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title LibVaultStorage
 * @notice Diamond storage layout for all VaultRegistry facets.
 *
 * Using the AppStorage pattern: a single struct at a well-known slot.
 * All facets share this storage via delegatecall.
 *
 * SECURITY NOTE: Storage slot collisions would be catastrophic here as they
 * could corrupt secret version records or access control state. The slot
 * is derived from the project-specific keccak256 hash to avoid collisions
 * with any other Diamond facets or OpenZeppelin libraries.
 */
library LibVaultStorage {
    bytes32 constant VAULT_STORAGE_POSITION =
        keccak256("vault.web3.registry.storage.v1");

    // ─── Enums ────────────────────────────────────────────────────────────────

    enum Role {
        Owner,   // 0: full control, can grant/revoke all roles
        Admin,   // 1: can write, can grant reader/writer roles
        Writer,  // 2: can write secrets under their namespace
        Reader   // 3: read-only
    }

    enum Operation {
        Read,    // 0
        Write,   // 1
        Delete,  // 2
        Rotate   // 3 — key rotation
    }

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct SecretVersion {
        uint256 version;
        string cid;             // IPFS CIDv1
        bytes32 plaintextHash;  // keccak256 of plaintext (for integrity checks)
        uint256 timestamp;
        address author;
        bool exists;
    }

    struct PolicyEntry {
        Role role;
        address grantee;
        uint256 expiresAt;  // 0 = never expires
        bool multiSigRequired;
        bool exists;
    }

    struct AuditEntry {
        address accessor;
        Operation operation;
        bool granted;
        uint256 timestamp;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    struct VaultStorage {
        // path => version number => SecretVersion
        mapping(bytes32 => mapping(uint256 => SecretVersion)) versions;
        // path => latest version number (0 means no secret)
        mapping(bytes32 => uint256) latestVersion;
        // path => grantee => PolicyEntry
        mapping(bytes32 => mapping(address => PolicyEntry)) policies;
        // path => AuditEntry[]
        mapping(bytes32 => AuditEntry[]) auditLog;
        // Global admin multisig threshold config
        uint256 globalThreshold;
        address[] globalSigners;
        // Paused flag for emergency stop
        bool paused;
        // path => who claimed it (first writer, or the admin who first granted a role on it).
        // Appended last so existing storage slots don't move.
        mapping(bytes32 => address) pathCreator;
    }

    function getStorage() internal pure returns (VaultStorage storage vs) {
        bytes32 position = VAULT_STORAGE_POSITION;
        assembly {
            vs.slot := position
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function pathKey(string memory path) internal pure returns (bytes32) {
        return keccak256(bytes(path));
    }

    function hasRole(
        VaultStorage storage vs,
        string memory path,
        address account,
        Role requiredRole
    ) internal view returns (bool) {
        bytes32 key = pathKey(path);
        PolicyEntry storage entry = vs.policies[key][account];
        if (!entry.exists) return false;
        if (entry.expiresAt != 0 && block.timestamp > entry.expiresAt) return false;
        // Role ordering: lower enum value = higher privilege
        return uint8(entry.role) <= uint8(requiredRole);
    }
}
