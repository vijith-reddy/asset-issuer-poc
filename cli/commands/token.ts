import { getAddress, isAddress, keccak256, parseEventLogs, toBytes, type Hash, type Log } from "viem";
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

type Output = Pick<NodeJS.WritableStream, "write">;

export async function handleTokenCommand(args: string[], context: ReplContext, output: Output): Promise<void> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "help") {
    writeTokenHelp(output);
    return;
  }

  if (subcommand === "list") {
    writeTokenList(context, output);
    return;
  }

  if (subcommand === "create-usdv") {
    await createUsdv(rest, context, output);
    return;
  }

  if (subcommand === "inspect") {
    await inspectToken(rest[0] ?? "USDV", context, output);
    return;
  }

  if (subcommand === "set-policy") {
    await setTokenPolicy(rest, context, output);
    return;
  }

  output.write(`Unknown token command: ${subcommand}\n`);
  writeTokenHelp(output);
}

function writeTokenHelp(output: Output): void {
  output.write(`Token commands:
  token create-usdv [--salt <salt>] [--admin <profile|address>] [--quote <pathUSD|address>]
  token list
  token inspect [symbol]
  token set-policy <symbol> <policy-name>
`);
}

function writeTokenList(context: ReplContext, output: Output): void {
  const tokens = Object.values(context.deployments.deployments)
    .filter((deployment) => deployment.kind === "tip20")
    .sort((left, right) => left.name.localeCompare(right.name));

  if (tokens.length === 0) {
    output.write("No local TIP-20 tokens found.\n");
    return;
  }

  for (const token of tokens) {
    output.write(`${token.name} ${token.address} network=${token.network}\n`);
  }
}

async function createUsdv(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const tokenKey = tokenStateKey("USDV");

  if (context.deployments.deployments[tokenKey]) {
    throw new Error("USDV already exists in local deployment state.");
  }

  const rawSalt = readOption(args, "--salt") ?? "usdv-poc";
  const salt = parseSalt(rawSalt);
  const adminArg = readOption(args, "--admin");
  const quoteArg = readOption(args, "--quote") ?? "pathUSD";
  const admin = adminArg ? resolveAddress(adminArg, context.accounts) : {
    label: active.name,
    address: active.address,
    isKnownProfile: true,
  };
  const quoteToken = resolveQuoteToken(quoteArg);
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
    args: ["USDV", "USDV", "USD", quoteToken, admin.address, salt],
  });

  const receipt = await context.publicClient.waitForTransactionReceipt({ hash });
  const tokenAddress = readCreatedTokenAddress(receipt.logs) ?? predictedAddress;
  const createdAt = nowIso();

  const record: DeploymentRecord = {
    name: "USDV",
    address: tokenAddress,
    network: context.network.key,
    kind: "tip20",
    txHash: hash,
    createdAt,
    metadata: {
      tokenName: "USDV",
      symbol: "USDV",
      currency: "USD",
      quoteToken,
      admin: admin.label,
      salt: rawSalt,
      saltBytes32: salt,
    },
  };

  context.deployments.deployments[tokenKey] = record;
  context.deployments.updatedAt = createdAt;
  await context.saveDeployments(context.deployments);
  await recordHistory(context, {
    action: "token create-usdv",
    summary: `created USDV ${tokenAddress}`,
    txs: [{ label: "createToken", hash }],
    metadata: {
      token: tokenAddress,
      predicted: predictedAddress,
      quoteToken,
      admin: admin.address,
      salt: rawSalt,
    },
  });

  output.write(`created USDV ${tokenAddress}\n`);
  output.write(`predicted ${predictedAddress}\n`);
  output.write(`quote ${quoteArg} ${quoteToken}\n`);
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
  output.write(`transfer policy id: ${transferPolicyId}\n`);
}

async function setTokenPolicy(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const [symbol, policyName] = args;

  if (!symbol || !policyName) {
    output.write("Usage: token set-policy <symbol> <policy-name>\n");
    return;
  }

  const token = requireToken(symbol, context);
  const policy = context.policies.policies[policyName];

  if (!policy) {
    throw new Error(`Unknown policy: ${policyName}`);
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

function requireActiveProfile(context: ReplContext) {
  if (!context.activeProfile) {
    throw new Error("No active profile. Use: use admin");
  }

  return context.activeProfile;
}

function requireToken(symbol: string, context: ReplContext): DeploymentRecord {
  const token = context.deployments.deployments[tokenStateKey(symbol)];

  if (!token || token.kind !== "tip20") {
    throw new Error(`Unknown TIP-20 token: ${symbol}`);
  }

  return token;
}

function tokenStateKey(symbol: string): string {
  return symbol.trim().toLowerCase();
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

function resolveQuoteToken(value: string): Address {
  const known = TESTNET_TIP20_TOKENS[value as keyof typeof TESTNET_TIP20_TOKENS];

  if (known) {
    return known;
  }

  if (!isAddress(value)) {
    throw new Error(`Unknown quote token: ${value}`);
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
