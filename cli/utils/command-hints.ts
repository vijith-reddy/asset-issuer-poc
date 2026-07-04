export function suggestTopLevelCommand(command: string): string | undefined {
  const normalized = command.trim().toLowerCase();

  if (normalized === "policies") return "policy list";
  if (normalized === "tokens") return "token list";
  if (normalized === "roles") return "token roles USDV";
  if (normalized === "managers") return "manager inspect";
  if (normalized === "who") return "whoami";
  if (normalized === "mint") return "admin-subscribe <recipient> <amount> or subscribe <amount>";
  if (normalized === "burn") return "redeem <amount>";
  if (normalized === "attach" || normalized === "attach-policy") return "token set-policy USDV <policy-name>";
  if (normalized === "grant-issuer") return "token grant-role USDV manager issuer";
  if (normalized === "select-policy") return "policy use <name>";
  if (normalized === "allowlist") return "policy allow <profile|address> [policy-name]";
  if (normalized === "blocklist") return "policy remove <profile|address> [whitelist-name] or policy block <profile|address> [blacklist-name]";
  if (normalized === "faucet") return "manager faucet";

  return undefined;
}
