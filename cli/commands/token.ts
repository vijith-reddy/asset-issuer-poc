import { randomBytes } from "node:crypto";
import { getAddress, isAddress, keccak256, parseEventLogs, toBytes, type Hash, type Hex, type Log } from "viem";
import { resolveAddress } from "../utils/address-book.js";
import {
  createTempoWalletClient,
  TESTNET_TIP20_TOKENS,
  TIP20_FACTORY_ADDRESS,
  tip20Abi,
  tip20FactoryAbi,
} from "../tempo/index.js";
import {
  nowIso,
  type Address,
  type DeploymentRecord,
} from "../state/index.js";
import type { ReplContext } from "../repl/context.js";
import { recordHistory } from "./history.js";
import { formatUnknownPolicyMessage } from "../utils/policy-hints.js";
import {
  TIP20_ROLE_DEFINITIONS,
  requireTip20RoleName,
  type Tip20RoleDefinition,
} from "../utils/tip20-roles.js";

type Output = Pick<NodeJS.WritableStream, "write">;

interface RoleTarget {
  label: string;
  address: Address;
  kind: "manager" | "profile" | "address";
}

export async function handleTokenCommand(args: string[], context: ReplContext, output: Output): Promise<void> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "help") {
    writeTokenHelp(output);
    return;
  }

  if (subcommand === "list") {
    await writeTokenList(context, output);
    return;
  }

  if (subcommand === "create-usdv") {
    await createUsdv(rest, context, output);
    return;
  }

  if (subcommand === "create") {
    await createToken(rest, context, output);
    return;
  }

  if (subcommand === "inspect") {
    await inspectToken(rest[0] ?? "USDV", context, output);
    return;
  }

  if (subcommand === "set-policy" || subcommand === "attach-policy") {
    await setTokenPolicy(rest, context, output);
    return;
  }

  if (subcommand === "roles") {
    await listTokenRoles(rest, context, output);
    return;
  }

  if (subcommand === "role-check" || subcommand === "has-role") {
    await checkTokenRole(rest, context, output);
    return;
  }

  if (subcommand === "grant-role") {
    await modifyTokenRole("grant", rest, context, output);
    return;
  }

  if (subcommand === "revoke-role") {
    await modifyTokenRole("revoke", rest, context, output);
    return;
  }

  output.write(`Unknown token command: ${subcommand}\n`);
  writeTokenHelp(output);
}

function writeTokenHelp(output: Output): void {
  output.write(`Token commands:
  token create <symbol> [--name <name>] [--currency <currency>] [--quote <pathUSD|address>] [--admin <profile|address>] [--salt <salt>]
  token create-usdv [--salt <salt>] [--admin <profile|address>] [--quote <pathUSD|address>]
  token list
  token inspect [symbol]
  token set-policy <symbol> <policy-name>
  token attach-policy <symbol> <policy-name>  alias for token set-policy
  token roles [symbol] [profile|address|manager]
  token role-check <symbol> <profile|address|manager> <role>
  token grant-role <symbol> <profile|address|manager> <role>
  token revoke-role <symbol> <profile|address|manager> <role>

Roles: issuer, burn-blocked, pause, unpause
Example: token grant-role USDV manager issuer
`);
}

async function writeTokenList(context: ReplContext, output: Output): Promise<void> {
  const tokens = Object.values(context.deployments.deployments)
    .filter((deployment) => deployment.kind === "tip20")
    .sort((left, right) => left.name.localeCompare(right.name));

  if (tokens.length === 0) {
    output.write("No local TIP-20 tokens found.\n");
    output.write("Create USDV with: token create-usdv\n");
    return;
  }

  for (const token of tokens) {
    output.write(`${token.name} ${token.address} network=${token.network}`);

    const transferPolicy = await readTransferPolicyDescription(token, context);
    if (transferPolicy) {
      output.write(` transferPolicy=${transferPolicy}`);
    }

    output.write("\n");
  }
}

async function createUsdv(args: string[], context: ReplContext, output: Output): Promise<void> {
  await createTip20Token({
    symbol: "USDV",
    name: "USDV",
    currency: "USD",
    quoteArg: readOption(args, "--quote") ?? "pathUSD",
    adminArg: readOption(args, "--admin"),
    rawSalt: readOption(args, "--salt") ?? randomSalt(),
    duplicateMessage: "USDV already exists in local deployment state.",
  }, context, output);
}

async function createToken(args: string[], context: ReplContext, output: Output): Promise<void> {
  const [symbol] = args;

  if (!symbol) {
    output.write("Usage: token create <symbol> [--name <name>] [--currency <currency>] [--quote <pathUSD|address>] [--admin <profile|address>] [--salt <salt>]\n");
    output.write("Example: token create DEMO --name DemoDollar --currency USD --quote pathUSD\n");
    return;
  }

  await createTip20Token({
    symbol,
    name: readOption(args, "--name") ?? symbol,
    currency: readOption(args, "--currency") ?? "USD",
    quoteArg: readOption(args, "--quote") ?? "pathUSD",
    adminArg: readOption(args, "--admin"),
    rawSalt: readOption(args, "--salt") ?? randomSalt(),
    duplicateMessage: `${symbol} already exists in local deployment state.`,
  }, context, output);
}

async function createTip20Token(
  params: {
    symbol: string;
    name: string;
    currency: string;
    quoteArg: string;
    adminArg: string | undefined;
    rawSalt: string;
    duplicateMessage: string;
  },
  context: ReplContext,
  output: Output,
): Promise<void> {
  const active = requireActiveProfile(context);
  const symbol = normalizeCreatedTokenSymbol(params.symbol);
  const tokenKey = tokenStateKey(symbol);

  if (context.deployments.deployments[tokenKey]) {
    throw new Error(params.duplicateMessage);
  }

  const salt = parseSalt(params.rawSalt);
  const admin = params.adminArg ? resolveAddress(params.adminArg, context.accounts) : {
    label: active.name,
    address: active.address,
    isKnownProfile: true,
  };
  const quoteToken = resolveQuoteToken(params.quoteArg);
  const walletClient = createTempoWalletClient(active, context.network);
  const predictedAddress = await context.publicClient.readContract({
    address: TIP20_FACTORY_ADDRESS,
    abi: tip20FactoryAbi,
    functionName: "getTokenAddress",
    args: [active.address, salt],
  });

  const hash = await walletClient.writeContract({
    address: TIP20_FACTORY_ADDRESS,
    abi: tip20FactoryAbi,
    functionName: "createToken",
    args: [params.name, symbol, params.currency, quoteToken, admin.address, salt],
  });

  const receipt = await context.publicClient.waitForTransactionReceipt({ hash });
  const tokenAddress = readCreatedTokenAddress(receipt.logs) ?? predictedAddress;
  const createdAt = nowIso();

  const record: DeploymentRecord = {
    name: symbol,
    address: tokenAddress,
    network: context.network.key,
    kind: "tip20",
    txHash: hash,
    createdAt,
    metadata: {
      tokenName: params.name,
      symbol,
      currency: params.currency,
      quoteToken,
      admin: admin.label,
      salt: params.rawSalt,
      saltBytes32: salt,
      transferPolicy: "always-allow",
      transferPolicyId: "1",
    },
  };

  context.deployments.deployments[tokenKey] = record;
  context.deployments.updatedAt = createdAt;
  await context.saveDeployments(context.deployments);
  await recordHistory(context, {
    action: symbol === "USDV" ? "token create-usdv" : "token create",
    summary: `created ${symbol} ${tokenAddress}`,
    txs: [{ label: "createToken", hash }],
    metadata: {
      token: tokenAddress,
      predicted: predictedAddress,
      quoteToken,
      admin: admin.address,
      salt: params.rawSalt,
    },
  });

  output.write(`created ${symbol} ${tokenAddress}\n`);
  output.write(`predicted ${predictedAddress}\n`);
  output.write(`name ${params.name}\n`);
  output.write(`currency ${params.currency}\n`);
  output.write(`quote ${params.quoteArg} ${quoteToken}\n`);
  output.write(`admin ${admin.label} ${admin.address}\n`);
  output.write(`tx: ${hash}\n`);
}

async function inspectToken(symbol: string, context: ReplContext, output: Output): Promise<void> {
  const token = requireToken(symbol, context);
  const [name, tokenSymbol, decimals, totalSupply, currency, quoteToken, transferPolicyId] = await Promise.all([
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "name",
    }),
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "symbol",
    }),
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "decimals",
    }),
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "currency",
    }),
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "quoteToken",
    }),
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "transferPolicyId",
    }),
  ]);

  output.write(`name: ${name}\n`);
  output.write(`symbol: ${tokenSymbol}\n`);
  output.write(`address: ${token.address}\n`);
  output.write(`decimals: ${decimals}\n`);
  output.write(`total supply: ${totalSupply}\n`);
  output.write(`currency: ${currency}\n`);
  output.write(`quote token: ${quoteToken}\n`);
  output.write(`transfer policy: ${describePolicyId(transferPolicyId.toString(), context)}\n`);
}

async function setTokenPolicy(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const [symbol, policyName] = args;

  if (!symbol || !policyName) {
    output.write("Usage: token set-policy <symbol> <policy-name>\n");
    output.write("Example: token set-policy USDV usdv-kyc\n");
    return;
  }

  const token = requireToken(symbol, context);
  const policy = context.policies.policies[policyName];

  if (!policy) {
    throw new Error(formatUnknownPolicyMessage(policyName, context.policies));
  }

  const walletClient = createTempoWalletClient(active, context.network);
  const hash = await walletClient.writeContract({
    address: token.address,
    abi: tip20Abi,
    functionName: "changeTransferPolicyId",
    args: [BigInt(policy.id)],
  });

  await context.publicClient.waitForTransactionReceipt({ hash });

  token.metadata = {
    ...(token.metadata ?? {}),
    transferPolicy: policy.name,
    transferPolicyId: policy.id,
  };
  context.deployments.updatedAt = nowIso();
  await context.saveDeployments(context.deployments);
  await recordHistory(context, {
    action: "token set-policy",
    summary: `${token.name} uses policy ${policy.name}`,
    txs: [{ label: "changeTransferPolicyId", hash }],
    metadata: {
      token: token.address,
      policy: policy.name,
      policyId: policy.id,
    },
  });

  output.write(`${token.name}: transfer policy=${policy.name} id=${policy.id}\n`);
  output.write(`tx: ${hash}\n`);
}

async function listTokenRoles(args: string[], context: ReplContext, output: Output): Promise<void> {
  const [symbolArg, targetArg] = args;
  const token = requireToken(symbolArg ?? "USDV", context);
  const target = targetArg
    ? resolveRoleTarget(targetArg, context)
    : maybeResolveManagerTarget(context);

  output.write(`TIP-20 roles for ${token.name} ${token.address}\n`);

  if (target) {
    output.write(`target: ${target.label} ${target.address}\n`);
  } else {
    output.write("target: none; deploy manager or pass a profile/address to check membership\n");
  }

  for (const role of TIP20_ROLE_DEFINITIONS) {
    const roleId = await readRoleId(token, role, context);
    const adminRole = await context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "getRoleAdmin",
      args: [roleId],
    });
    const status = target
      ? await context.publicClient.readContract({
        address: token.address,
        abi: tip20Abi,
        functionName: "hasRole",
        args: [target.address, roleId],
      })
      : undefined;

    output.write(`${role.name} ${role.displayName}\n`);
    output.write(`  id: ${roleId}\n`);
    output.write(`  admin role: ${describeRoleId(adminRole, roleId)}\n`);

    if (target) {
      output.write(`  ${target.label}: ${status ? "granted" : "not granted"}\n`);
    }

    output.write(`  ${role.description}\n`);
  }

  output.write("Use: token grant-role USDV manager issuer\n");
  output.write("Use: token revoke-role USDV <profile|address|manager> <role>\n");
}

async function checkTokenRole(args: string[], context: ReplContext, output: Output): Promise<void> {
  const [symbol, targetArg, roleArg] = args;

  if (!symbol || !targetArg || !roleArg) {
    output.write("Usage: token role-check <symbol> <profile|address|manager> <role>\n");
    output.write("Example: token role-check USDV manager issuer\n");
    return;
  }

  const token = requireToken(symbol, context);
  const target = resolveRoleTarget(targetArg, context);
  const role = requireTip20RoleName(roleArg);
  const roleId = await readRoleId(token, role, context);
  const hasRole = await context.publicClient.readContract({
    address: token.address,
    abi: tip20Abi,
    functionName: "hasRole",
    args: [target.address, roleId],
  });

  output.write(`${target.label} ${hasRole ? "has" : "does not have"} ${role.displayName} on ${token.name}\n`);
  output.write(`target: ${target.address}\n`);
  output.write(`role id: ${roleId}\n`);
}

async function modifyTokenRole(
  action: "grant" | "revoke",
  args: string[],
  context: ReplContext,
  output: Output,
): Promise<void> {
  const active = requireActiveProfile(context);
  const [symbol, targetArg, roleArg] = args;

  if (!symbol || !targetArg || !roleArg) {
    output.write(`Usage: token ${action}-role <symbol> <profile|address|manager> <role>\n`);
    output.write(`Example: token ${action}-role USDV manager issuer\n`);
    return;
  }

  const token = requireToken(symbol, context);
  const target = resolveRoleTarget(targetArg, context);
  const role = requireTip20RoleName(roleArg);
  const roleId = await readRoleId(token, role, context);
  const walletClient = createTempoWalletClient(active, context.network);
  const hash = await walletClient.writeContract({
    address: token.address,
    abi: tip20Abi,
    functionName: action === "grant" ? "grantRole" : "revokeRole",
    args: [roleId, target.address],
  });

  await context.publicClient.waitForTransactionReceipt({ hash });
  updateLocalRoleMetadata(token, action, target, role, hash);
  context.deployments.updatedAt = nowIso();
  await context.saveDeployments(context.deployments);
  await recordHistory(context, {
    action: `token ${action}-role`,
    summary: `${action === "grant" ? "granted" : "revoked"} ${role.name} for ${target.label}`,
    txs: [{ label: action === "grant" ? "grantRole" : "revokeRole", hash }],
    metadata: {
      token: token.address,
      target: target.address,
      role: role.name,
      roleId,
    },
  });

  output.write(`${action === "grant" ? "granted" : "revoked"} ${role.displayName} on ${token.name} for ${target.label}\n`);
  output.write(`target: ${target.address}\n`);
  output.write(`role id: ${roleId}\n`);

  if (action === "grant" && role.name === "issuer" && target.kind !== "manager") {
    output.write("warning: issuer allows mint/burn outside the manager flow; for this POC prefer manager as the issuer holder.\n");
  }

  if (action === "revoke" && target.kind === "manager" && role.name === "issuer") {
    output.write("warning: revoking issuer from manager will break subscribe/admin-subscribe minting.\n");
  }

  output.write(`tx: ${hash}\n`);
}

function requireActiveProfile(context: ReplContext) {
  if (!context.activeProfile) {
    throw new Error("No active profile. Use: use admin");
  }

  return context.activeProfile;
}

function requireToken(symbol: string, context: ReplContext): DeploymentRecord {
  const token = context.deployments.deployments[tokenStateKey(symbol)];

  if (!token || token.kind !== "tip20") {
    throw new Error([
      `Unknown TIP-20 token: ${symbol}`,
      "Run: token list",
      "If USDV is missing, create it with: token create-usdv",
    ].join("\n"));
  }

  return token;
}

function tokenStateKey(symbol: string): string {
  return symbol.trim().toLowerCase();
}

function normalizeCreatedTokenSymbol(symbol: string): string {
  const normalized = symbol.trim();

  if (!/^[A-Za-z][A-Za-z0-9]{1,15}$/.test(normalized)) {
    throw new Error("Token symbol must start with a letter and use 2-16 letters or numbers.");
  }

  return normalized.toUpperCase();
}

function parseSalt(value: string): Hash {
  if (value.startsWith("0x")) {
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
      return value as Hash;
    }

    throw new Error("Hex salt must be exactly 32 bytes.");
  }

  // Hashing a readable salt gives the factory a fixed bytes32 value without length limits.
  return keccak256(toBytes(value));
}

function randomSalt(): Hash {
  return `0x${randomBytes(32).toString("hex")}`;
}

function resolveQuoteToken(value: string): Address {
  const known = TESTNET_TIP20_TOKENS[value as keyof typeof TESTNET_TIP20_TOKENS];

  if (known) {
    return known;
  }

  if (!isAddress(value)) {
    throw new Error(`Unknown quote token: ${value}. Use pathUSD or a valid 0x token address.`);
  }

  return getAddress(value);
}

function readOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function readCreatedTokenAddress(logs: readonly Log[]): Address | undefined {
  const events = parseEventLogs({
    abi: tip20FactoryAbi,
    eventName: "TokenCreated",
    logs: [...logs],
  });

  return events[0]?.args.token;
}

async function readRoleId(
  token: DeploymentRecord,
  role: Tip20RoleDefinition,
  context: ReplContext,
): Promise<Hex> {
  return context.publicClient.readContract({
    address: token.address,
    abi: tip20Abi,
    functionName: role.functionName,
  });
}

function resolveRoleTarget(value: string, context: ReplContext): RoleTarget {
  if (value.trim().toLowerCase() === "manager") {
    const manager = context.deployments.deployments.manager;

    if (!manager || manager.kind !== "manager") {
      throw new Error([
        "Missing deployment: manager",
        "Run: manager deploy",
        "Then grant roles with: manager grant-operational-roles",
      ].join("\n"));
    }

    return {
      label: "manager",
      address: manager.address,
      kind: "manager",
    };
  }

  const resolved = resolveAddress(value, context.accounts);

  return {
    label: resolved.label,
    address: resolved.address,
    kind: resolved.isKnownProfile ? "profile" : "address",
  };
}

function maybeResolveManagerTarget(context: ReplContext): RoleTarget | undefined {
  const manager = context.deployments.deployments.manager;

  if (!manager || manager.kind !== "manager") {
    return undefined;
  }

  return {
    label: "manager",
    address: manager.address,
    kind: "manager",
  };
}

function updateLocalRoleMetadata(
  token: DeploymentRecord,
  action: "grant" | "revoke",
  target: RoleTarget,
  role: Tip20RoleDefinition,
  hash: Hash,
): void {
  const prefix = `role.${role.name}.${target.label}`;

  token.metadata = {
    ...(token.metadata ?? {}),
    [`${prefix}.address`]: target.address,
    [`${prefix}.status`]: action === "grant" ? "granted" : "revoked",
    [`${prefix}.tx`]: hash,
  };
}

function describeRoleId(adminRole: Hex, ownRole: Hex): string {
  if (adminRole === ownRole) {
    return `${adminRole} self-admin`;
  }

  return adminRole;
}

async function readTransferPolicyDescription(token: DeploymentRecord, context: ReplContext): Promise<string | undefined> {
  try {
    const policyId = await context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "transferPolicyId",
    });

    return describePolicyId(policyId.toString(), context);
  } catch {
    const policyName = token.metadata?.transferPolicy;
    const policyId = token.metadata?.transferPolicyId;

    if (policyName && policyId) {
      return `${policyName}:${policyId} local`;
    }

    if (policyId) {
      return `id:${policyId} local`;
    }

    return undefined;
  }
}

function describePolicyId(policyId: string, context: ReplContext): string {
  if (policyId === "0") {
    return "always-reject:0";
  }

  if (policyId === "1") {
    return "always-allow:1";
  }

  const policy = Object.values(context.policies.policies).find((record) => record.id === policyId);

  if (policy) {
    return `${policy.name}:${policy.id}`;
  }

  return `id:${policyId}`;
}
