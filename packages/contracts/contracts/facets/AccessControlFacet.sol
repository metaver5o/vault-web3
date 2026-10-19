// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LibDiamond} from "../diamond/LibDiamond.sol";
import {LibVaultStorage} from "../libraries/LibVaultStorage.sol";

/**
 * @title AccessControlFacet
 * @notice Role-based access control for secret paths.
 *
 * Role hierarchy (ascending privilege):
 *   Reader (3) < Writer (2) < Admin (1) < Owner (0)
 *
 * Roles are path-scoped: granting Writer on "secret/myapp/" does NOT
 * automatically grant Writer on "secret/myapp/db" — paths are exact matches
 * at this layer. Namespace inheritance must be implemented at the application layer.
 *
 * TIME-LOCKED ROLES:
 *   Set expiresAt > 0 to create a time-limited grant (e.g., for CI/CD tokens).
 *   Expired roles are enforced on-chain at read time — no maintenance needed.
 *
 * MULTI-SIG FLAG:
 *   Setting multiSigRequired = true on a policy signals to the application layer
 *   that the secret requires threshold Trezor signing to decrypt. The contract
 *   does NOT enforce the multi-sig cryptography itself (that's off-chain); it
 *   records the requirement for audit purposes and app-layer enforcement.
 */
contract AccessControlFacet {
    event RoleGranted(
        string indexed pathIndexed,
        string path,
        address indexed grantee,
        LibVaultStorage.Role role,
        uint256 expiresAt,
        bool multiSigRequired
    );

    event RoleRevoked(
        string indexed pathIndexed,
        string path,
        address indexed grantee
    );

    event AccessAttempt(
        string indexed pathIndexed,
        string path,
        address indexed accessor,
        LibVaultStorage.Operation operation,
        bool granted
    );

    modifier onlyAdmin(string calldata path) {
        require(
            _isAdmin(path, msg.sender),
            "AccessControl: caller lacks Admin role"
        );
        _;
    }

    function _isAdmin(string memory path, address account) internal view returns (bool) {
        LibVaultStorage.VaultStorage storage vs = LibVaultStorage.getStorage();
        // Diamond owner always has implicit Owner role
        if (account == LibDiamond.contractOwner()) return true;
        return LibVaultStorage.hasRole(vs, path, account, LibVaultStorage.Role.Admin);
    }

    /**
     * @notice Grant a role on a path to an address.
     * @param path             Secret path
     * @param grantee          Address to grant the role to
     * @param role             Role enum (0=Owner,1=Admin,2=Writer,3=Reader)
     * @param expiresAt        Unix timestamp (0=never)
     * @param multiSigRequired Whether multi-Trezor confirmation is required
     */
    function grantRole(
        string calldata path,
        address grantee,
        LibVaultStorage.Role role,
        uint256 expiresAt,
        bool multiSigRequired
    ) external onlyAdmin(path) {
        require(grantee != address(0), "AccessControl: grantee is zero address");
        // Prevent privilege escalation: only Owner can grant Owner role
        if (role == LibVaultStorage.Role.Owner) {
            require(
                msg.sender == LibDiamond.contractOwner(),
                "AccessControl: only diamond owner can grant Owner role"
            );
        }

        LibVaultStorage.VaultStorage storage vs = LibVaultStorage.getStorage();
        bytes32 key = LibVaultStorage.pathKey(path);

        vs.policies[key][grantee] = LibVaultStorage.PolicyEntry({
            role: role,
            grantee: grantee,
            expiresAt: expiresAt,
            multiSigRequired: multiSigRequired,
            exists: true
        });

        emit RoleGranted(path, path, grantee, role, expiresAt, multiSigRequired);
    }

    /**
     * @notice Revoke a role from an address.
     */
    function revokeRole(string calldata path, address grantee) external onlyAdmin(path) {
        LibVaultStorage.VaultStorage storage vs = LibVaultStorage.getStorage();
        bytes32 key = LibVaultStorage.pathKey(path);

        require(vs.policies[key][grantee].exists, "AccessControl: policy does not exist");
        delete vs.policies[key][grantee];

        emit RoleRevoked(path, path, grantee);
    }

    /**
     * @notice Check if an address has at least the given role on a path.
     * Respects expiry.
     */
    function hasRole(
        string calldata path,
        address account,
        LibVaultStorage.Role role
    ) external view returns (bool) {
        if (account == LibDiamond.contractOwner()) return true;
        LibVaultStorage.VaultStorage storage vs = LibVaultStorage.getStorage();
        return LibVaultStorage.hasRole(vs, path, account, role);
    }

    /**
     * @notice Fetch the full policy entry for a (path, account) pair.
     */
    function getPolicy(string calldata path, address account)
        external
        view
        returns (LibVaultStorage.PolicyEntry memory)
    {
        bytes32 key = LibVaultStorage.pathKey(path);
        return LibVaultStorage.getStorage().policies[key][account];
    }

    /**
     * @notice Record an access attempt in the on-chain audit log.
     * @dev Called by the API server after access check — pure audit record.
     *      The contract trusts the caller here; caller must be authenticated.
     *      In production, restrict this to a trusted relayer address.
     */
    function recordAccessAttempt(
        string calldata path,
        LibVaultStorage.Operation operation,
        bool granted
    ) external {
        LibVaultStorage.VaultStorage storage vs = LibVaultStorage.getStorage();
        bytes32 key = LibVaultStorage.pathKey(path);

        vs.auditLog[key].push(LibVaultStorage.AuditEntry({
            accessor: msg.sender,
            operation: operation,
            granted: granted,
            timestamp: block.timestamp
        }));

        emit AccessAttempt(path, path, msg.sender, operation, granted);
    }

    /**
     * @notice Emergency pause — only diamond owner.
     */
    function setPaused(bool paused) external {
        LibDiamond.enforceIsContractOwner();
        LibVaultStorage.getStorage().paused = paused;
    }
}
