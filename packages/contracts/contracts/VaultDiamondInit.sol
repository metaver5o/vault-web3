// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LibDiamond} from "./diamond/LibDiamond.sol";
import {LibVaultStorage} from "./libraries/LibVaultStorage.sol";
import {IDiamondLoupe} from "./diamond/interfaces/IDiamondLoupe.sol";
import {IDiamondCut} from "./diamond/interfaces/IDiamondCut.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title VaultDiamondInit
 * @notice Initialization contract called via delegatecall during diamond deployment.
 *
 * Sets up ERC-165 interface registrations and grants the deployer the Owner role
 * on the global namespace ("/") so they can begin granting roles to other addresses.
 *
 * This contract is only called once during deployment and has no further use.
 */
contract VaultDiamondInit {
    function init() external {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();

        // Register ERC-165 interfaces
        ds.supportedInterfaces[type(IERC165).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;

        // Grant Owner role on root namespace to diamond owner
        LibVaultStorage.VaultStorage storage vs = LibVaultStorage.getStorage();
        address owner = LibDiamond.contractOwner();
        bytes32 rootKey = LibVaultStorage.pathKey("/");
        vs.policies[rootKey][owner] = LibVaultStorage.PolicyEntry({
            role: LibVaultStorage.Role.Owner,
            grantee: owner,
            expiresAt: 0,
            multiSigRequired: false,
            exists: true
        });
    }
}
