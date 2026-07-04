// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITIP20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function mintWithMemo(address to, uint256 amount, bytes32 memo) external;
    function burnWithMemo(uint256 amount, bytes32 memo) external;
}
