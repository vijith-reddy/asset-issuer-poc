export type Tip20RoleName = "issuer" | "burn-blocked" | "pause" | "unpause";
export type Tip20RoleFunctionName = "ISSUER_ROLE" | "BURN_BLOCKED_ROLE" | "PAUSE_ROLE" | "UNPAUSE_ROLE";

export interface Tip20RoleDefinition {
  name: Tip20RoleName;
  displayName: string;
  functionName: Tip20RoleFunctionName;
  aliases: string[];
  description: string;
}

export const TIP20_ROLE_DEFINITIONS: Tip20RoleDefinition[] = [
  {
    name: "issuer",
    displayName: "ISSUER_ROLE",
    functionName: "ISSUER_ROLE",
    aliases: ["issuer", "minter", "mint"],
    description: "Allows operational issuance flows such as manager mint lifecycle calls.",
  },
  {
    name: "burn-blocked",
    displayName: "BURN_BLOCKED_ROLE",
    functionName: "BURN_BLOCKED_ROLE",
    aliases: ["burn-blocked", "burn_blocked", "blocked-burner", "blockedburner", "burner", "burn"],
    description: "Allows burning from blocked accounts; this is the closest TIP-20 burn authority exposed by the role surface.",
  },
  {
    name: "pause",
    displayName: "PAUSE_ROLE",
    functionName: "PAUSE_ROLE",
    aliases: ["pause", "pauser"],
    description: "Allows pausing the TIP-20 token.",
  },
  {
    name: "unpause",
    displayName: "UNPAUSE_ROLE",
    functionName: "UNPAUSE_ROLE",
    aliases: ["unpause", "unpauser"],
    description: "Allows unpausing the TIP-20 token.",
  },
];

export const TIP20_MANAGER_OPERATIONAL_ROLE_NAMES: Tip20RoleName[] = [
  "issuer",
  "burn-blocked",
  "pause",
  "unpause",
];

export function parseTip20RoleName(value: string): Tip20RoleDefinition | undefined {
  const normalized = value.trim().toLowerCase();

  return TIP20_ROLE_DEFINITIONS.find((role) => role.aliases.includes(normalized));
}

export function requireTip20RoleName(value: string): Tip20RoleDefinition {
  const role = parseTip20RoleName(value);

  if (!role) {
    throw new Error([
      `Unknown TIP-20 role: ${value}`,
      `Known roles: ${TIP20_ROLE_DEFINITIONS.map((definition) => definition.name).join(", ")}`,
      "Use: token roles USDV",
    ].join("\n"));
  }

  return role;
}

export function getTip20RoleDefinition(name: Tip20RoleName): Tip20RoleDefinition {
  return TIP20_ROLE_DEFINITIONS.find((role) => role.name === name)!;
}
