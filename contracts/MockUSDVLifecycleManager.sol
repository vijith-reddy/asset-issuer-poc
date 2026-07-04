// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITIP20} from "./interfaces/ITIP20.sol";

contract MockUSDVLifecycleManager {
    error InvalidAmount();
    error Slippage();
    error TransferFailed();
    error Unauthorized();
    error UnsupportedToken();
    error ZeroAddress();

    ITIP20 public immutable usdv;
    ITIP20 public immutable settlementToken;
    address public admin;

    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event Subscribed(address indexed user, address indexed fundingToken, uint256 fundingAmount, uint256 usdvOut, bytes32 memo);
    event Redeemed(address indexed user, address indexed receivingToken, uint256 usdvAmount, uint256 tokenOut, bytes32 memo);
    event AdminSubscribed(address indexed operator, address indexed recipient, uint256 fundingAmount, uint256 usdvOut, bytes32 memo);

    constructor(ITIP20 usdv_, ITIP20 settlementToken_, address admin_) {
        if (address(usdv_) == address(0) || address(settlementToken_) == address(0) || admin_ == address(0)) {
            revert ZeroAddress();
        }

        usdv = usdv_;
        settlementToken = settlementToken_;
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

    function subscribe(address fundingToken, uint256 fundingAmount, uint256 minUsdvOut) external returns (uint256 usdvOut) {
        if (fundingToken != address(settlementToken)) revert UnsupportedToken();
        if (fundingAmount == 0) revert InvalidAmount();

        // This POC uses a simple 1:1 6-decimal pathUSD -> USDV conversion.
        usdvOut = fundingAmount;
        if (usdvOut < minUsdvOut) revert Slippage();

        if (!settlementToken.transferFrom(msg.sender, address(this), fundingAmount)) revert TransferFailed();

        bytes32 memo = _memo("SUBSCRIBE", msg.sender, fundingAmount);
        usdv.mintWithMemo(msg.sender, usdvOut, memo);

        emit Subscribed(msg.sender, fundingToken, fundingAmount, usdvOut, memo);
    }

    function redeem(uint256 usdvAmount, address receivingToken, uint256 minTokenOut) external returns (uint256 tokenOut) {
        if (receivingToken != address(settlementToken)) revert UnsupportedToken();
        if (usdvAmount == 0) revert InvalidAmount();

        // This POC uses a simple 1:1 6-decimal USDV -> pathUSD conversion.
        tokenOut = usdvAmount;
        if (tokenOut < minTokenOut) revert Slippage();

        if (!usdv.transferFrom(msg.sender, address(this), usdvAmount)) revert TransferFailed();

        bytes32 memo = _memo("REDEEM", msg.sender, usdvAmount);
        usdv.burnWithMemo(usdvAmount, memo);

        if (!settlementToken.transfer(msg.sender, tokenOut)) revert TransferFailed();

        emit Redeemed(msg.sender, receivingToken, usdvAmount, tokenOut, memo);
    }

    function adminSubscribe(
        address recipient,
        uint256 fundingAmount,
        uint256 minUsdvOut,
        bytes32 memo
    ) external onlyAdmin returns (uint256 usdvOut) {
        if (recipient == address(0)) revert ZeroAddress();
        if (fundingAmount == 0) revert InvalidAmount();

        // Admin subscriptions model offchain settlement: no funding token is pulled onchain.
        usdvOut = fundingAmount;
        if (usdvOut < minUsdvOut) revert Slippage();

        usdv.mintWithMemo(recipient, usdvOut, memo);

        emit AdminSubscribed(msg.sender, recipient, fundingAmount, usdvOut, memo);
    }

    function _memo(string memory action, address account, uint256 amount) internal view returns (bytes32) {
        return keccak256(abi.encode(action, account, amount, block.chainid, block.number));
    }
}
