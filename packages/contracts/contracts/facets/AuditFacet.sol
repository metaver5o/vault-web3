// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LibVaultStorage} from "../libraries/LibVaultStorage.sol";

/**
 * @title AuditFacet
 * @notice Read-only access to the on-chain audit log.
 *
 * The audit log is append-only — entries cannot be modified or deleted.
 * This gives an immutable record of every access attempt and write operation.
 *
 * NOTE: Storing audit entries in contract storage is expensive. For high-volume
 * deployments, emit events only and use an off-chain indexer (The Graph, Ponder)
 * to serve audit queries. The current design stores in storage for simplicity
 * and to support on-chain access control rules that depend on audit history
 * (e.g., "freeze account after 3 failed read attempts").
 */
contract AuditFacet {
    /**
     * @notice Get all audit log entries for a path.
     * @dev O(n) — use paginated variant for paths with long histories.
     */
    function getAuditLog(string calldata path)
        external
        view
        returns (LibVaultStorage.AuditEntry[] memory)
    {
        bytes32 key = LibVaultStorage.pathKey(path);
        return LibVaultStorage.getStorage().auditLog[key];
    }

    /**
     * @notice Paginated audit log.
     * @param path     Secret path
     * @param offset   Start index
     * @param limit    Max entries to return
     */
    function getAuditLogPaginated(
        string calldata path,
        uint256 offset,
        uint256 limit
    )
        external
        view
        returns (LibVaultStorage.AuditEntry[] memory entries, uint256 total)
    {
        bytes32 key = LibVaultStorage.pathKey(path);
        LibVaultStorage.AuditEntry[] storage log = LibVaultStorage.getStorage().auditLog[key];
        total = log.length;
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end > offset ? end - offset : 0;
        entries = new LibVaultStorage.AuditEntry[](count);
        for (uint256 i = 0; i < count; i++) {
            entries[i] = log[offset + i];
        }
    }

    /**
     * @notice Count total audit entries for a path.
     */
    function auditLogLength(string calldata path) external view returns (uint256) {
        bytes32 key = LibVaultStorage.pathKey(path);
        return LibVaultStorage.getStorage().auditLog[key].length;
    }
}
