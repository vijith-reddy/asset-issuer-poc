import type { PoliciesState } from "../state/index.js";

export function formatUnknownPolicyMessage(name: string, policies: PoliciesState): string {
  const names = listPolicyNames(policies);
  const lines = [`Unknown policy: ${name}`];

  if (names.length > 0) {
    lines.push("Run: policy list");
    lines.push(`Known policies: ${names.join(", ")}`);
  } else {
    lines.push("No local policies found.");
    lines.push("Create one with: policy create usdv-kyc whitelist");
  }

  lines.push(`To create "${name}", run: policy create ${name} whitelist`);

  return lines.join("\n");
}

export function formatNoActivePolicyMessage(policies: PoliciesState): string {
  const names = listPolicyNames(policies);

  if (names.length === 0) {
    return [
      "No active policy selected and no local policies exist.",
      "Create one with: policy create usdv-kyc whitelist",
    ].join("\n");
  }

  if (names.length === 1) {
    return `No active policy selected. Use: policy use ${names[0]}`;
  }

  return [
    "No active policy selected.",
    "Run: policy list",
    "Then select one with: policy use <name>",
  ].join("\n");
}

export function listPolicyNames(policies: PoliciesState): string[] {
  return Object.values(policies.policies)
    .map((policy) => policy.name)
    .sort((left, right) => left.localeCompare(right));
}
