import { parseAbi } from "viem";
import type { PolicyType } from "../state/index.js";

export const TIP403_REGISTRY_ADDRESS = "0x403c000000000000000000000000000000000000";

export const tip403RegistryAbi = parseAbi([
  "function createPolicy(address admin, uint8 policyType) external returns (uint64)",
  "function modifyPolicyWhitelist(uint64 policyId, address account, bool allowed) external",
  "function modifyPolicyBlacklist(uint64 policyId, address account, bool restricted) external",
  "function setPolicyAdmin(uint64 policyId, address admin) external",
  "function isAuthorized(uint64 policyId, address user) external view returns (bool)",
  "function policyData(uint64 policyId) external view returns (uint8 policyType, address admin)",
  "function policyExists(uint64 policyId) external view returns (bool)",
  "event PolicyCreated(uint64 indexed policyId, address indexed updater, uint8 policyType)",
  "event WhitelistUpdated(uint64 indexed policyId, address indexed updater, address indexed account, bool allowed)",
  "event BlacklistUpdated(uint64 indexed policyId, address indexed updater, address indexed account, bool restricted)",
  "event PolicyAdminUpdated(uint64 indexed policyId, address indexed updater, address indexed admin)",
]);

export function toTip403PolicyType(value: PolicyType): number {
  return value === "whitelist" ? 0 : 1;
}

export function fromTip403PolicyType(value: number): PolicyType {
  if (value === 0) return "whitelist";
  if (value === 1) return "blacklist";

  throw new Error(`Unknown TIP-403 policy type: ${value}`);
}
