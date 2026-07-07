// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITIP20} from "./interfaces/ITIP20.sol";

contract MultiAssetLifecycleManager {
    error InvalidAmount();
    error RouteDisabled();
    error RouteMissing();
    error Slippage();
    error TransferFailed();
    error Unauthorized();
    error UnsupportedToken();
    error ZeroAddress();

    struct Route {
        ITIP20 asset;
        ITIP20 settlementToken;
        bool enabled;
    }

    address public admin;

    mapping(address asset => Route route) private routes;
    address[] private routeAssets;

    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event RouteRegistered(address indexed asset, address indexed settlementToken, bool enabled);
    event RouteEnabled(address indexed asset, bool enabled);
    event Subscribed(address indexed asset, address indexed user, address indexed fundingToken, uint256 fundingAmount, uint256 assetOut, bytes32 memo);
    event Redeemed(address indexed asset, address indexed user, address indexed receivingToken, uint256 assetAmount, uint256 tokenOut, bytes32 memo);
    event AdminSubscribed(address indexed asset, address indexed operator, address indexed recipient, uint256 fundingAmount, uint256 assetOut, bytes32 memo);

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();

        admin = admin_;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();

        address oldAdmin = admin;
        admin = newAdmin;
        emit AdminUpdated(oldAdmin, newAdmin);
    }

    function registerRoute(address asset, address settlementToken, bool enabled) external onlyAdmin {
        if (asset == address(0) || settlementToken == address(0)) revert ZeroAddress();

        if (address(routes[asset].asset) == address(0)) {
            routeAssets.push(asset);
        }

        routes[asset] = Route({
            asset: ITIP20(asset),
            settlementToken: ITIP20(settlementToken),
            enabled: enabled
        });

        emit RouteRegistered(asset, settlementToken, enabled);
    }

    function setRouteEnabled(address asset, bool enabled) external onlyAdmin {
        Route storage route = routes[asset];
        if (address(route.asset) == address(0)) revert RouteMissing();

        route.enabled = enabled;
        emit RouteEnabled(asset, enabled);
    }

    function routeInfo(address asset) external view returns (address settlementToken, bool enabled) {
        Route storage route = routes[asset];
        if (address(route.asset) == address(0)) revert RouteMissing();

        return (address(route.settlementToken), route.enabled);
    }

    function routeCount() external view returns (uint256) {
        return routeAssets.length;
    }

    function routeAt(uint256 index) external view returns (address asset) {
        return routeAssets[index];
    }

    function subscribe(address asset, address fundingToken, uint256 fundingAmount, uint256 minAssetOut) external returns (uint256 assetOut) {
        Route storage route = _requireEnabledRoute(asset);
        if (fundingToken != address(route.settlementToken)) revert UnsupportedToken();
        if (fundingAmount == 0) revert InvalidAmount();

        // This POC uses a simple 1:1 6-decimal settlement token -> asset conversion.
        assetOut = fundingAmount;
        if (assetOut < minAssetOut) revert Slippage();

        if (!route.settlementToken.transferFrom(msg.sender, address(this), fundingAmount)) revert TransferFailed();

        bytes32 memo = _memo("SUBSCRIBE", asset, msg.sender, fundingAmount);
        route.asset.mintWithMemo(msg.sender, assetOut, memo);

        emit Subscribed(asset, msg.sender, fundingToken, fundingAmount, assetOut, memo);
    }

    function redeem(address asset, uint256 assetAmount, address receivingToken, uint256 minTokenOut) external returns (uint256 tokenOut) {
        Route storage route = _requireEnabledRoute(asset);
        if (receivingToken != address(route.settlementToken)) revert UnsupportedToken();
        if (assetAmount == 0) revert InvalidAmount();

        // This POC uses a simple 1:1 6-decimal asset -> settlement token conversion.
        tokenOut = assetAmount;
        if (tokenOut < minTokenOut) revert Slippage();

        if (!route.asset.transferFrom(msg.sender, address(this), assetAmount)) revert TransferFailed();

        bytes32 memo = _memo("REDEEM", asset, msg.sender, assetAmount);
        route.asset.burnWithMemo(assetAmount, memo);

        if (!route.settlementToken.transfer(msg.sender, tokenOut)) revert TransferFailed();

        emit Redeemed(asset, msg.sender, receivingToken, assetAmount, tokenOut, memo);
    }

    function adminSubscribe(
        address asset,
        address recipient,
        uint256 fundingAmount,
        uint256 minAssetOut,
        bytes32 memo
    ) external onlyAdmin returns (uint256 assetOut) {
        Route storage route = _requireEnabledRoute(asset);
        if (recipient == address(0)) revert ZeroAddress();
        if (fundingAmount == 0) revert InvalidAmount();

        // Admin subscriptions model offchain settlement: no funding token is pulled onchain.
        assetOut = fundingAmount;
        if (assetOut < minAssetOut) revert Slippage();

        route.asset.mintWithMemo(recipient, assetOut, memo);

        emit AdminSubscribed(asset, msg.sender, recipient, fundingAmount, assetOut, memo);
    }

    function _requireEnabledRoute(address asset) internal view returns (Route storage route) {
        route = routes[asset];
        if (address(route.asset) == address(0)) revert RouteMissing();
        if (!route.enabled) revert RouteDisabled();
    }

    function _memo(string memory action, address asset, address account, uint256 amount) internal view returns (bytes32) {
        return keccak256(abi.encode(action, asset, account, amount, block.chainid, block.number));
    }
}
