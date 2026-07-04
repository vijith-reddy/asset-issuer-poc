import { parseAbi } from "viem";

export const TIP20_FACTORY_ADDRESS = "0x20Fc000000000000000000000000000000000000";

export const TESTNET_TIP20_TOKENS = {
  pathUSD: "0x20c0000000000000000000000000000000000000",
  AlphaUSD: "0x20c0000000000000000000000000000000000001",
  BetaUSD: "0x20c0000000000000000000000000000000000002",
  ThetaUSD: "0x20c0000000000000000000000000000000000003",
} as const;

export const tip20FactoryAbi = parseAbi([
  "function createToken(string name, string symbol, string currency, address quoteToken, address admin, bytes32 salt) external returns (address token)",
  "function getTokenAddress(address sender, bytes32 salt) external pure returns (address token)",
  "function isTIP20(address token) external view returns (bool)",
  "event TokenCreated(address indexed token, string name, string symbol, string currency, address quoteToken, address admin, bytes32 salt)",
]);

export const tip20Abi = parseAbi([
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external pure returns (uint8)",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transferWithMemo(address to, uint256 amount, bytes32 memo) external",
  "function currency() external view returns (string)",
  "function quoteToken() external view returns (address)",
  "function transferPolicyId() external view returns (uint64)",
  "function changeTransferPolicyId(uint64 newPolicyId) external",
  "function ISSUER_ROLE() external view returns (bytes32)",
  "function grantRole(bytes32 role, address account) external",
  "error ContractPaused()",
  "error InsufficientBalance(uint256 currentBalance, uint256 expectedBalance, address token)",
  "error InvalidAmount()",
  "error InvalidRecipient()",
  "error PolicyForbids()",
  "error SupplyCapExceeded()",
  "error Unauthorized()",
  "event TokenCreated(address indexed token, string name, string symbol, string currency, address quoteToken, address admin, bytes32 salt)",
  "event TransferPolicyUpdate(address indexed updater, uint64 indexed newPolicyId)",
  "event RoleMembershipUpdated(bytes32 indexed role, address indexed account, address indexed sender, bool hasRole)",
]);
