import { keccak256, padHex, stringToHex, toBytes, type Address, type Hex } from "viem";
import { resolveAddress, type ResolvedAddress } from "../utils/address-book.js";
import { formatTip20Amount, parseTip20Amount } from "../utils/amount.js";
import { isPolicyForbidsError } from "../utils/errors.js";
import {
  createTempoWalletClient,
  TESTNET_TIP20_TOKENS,
  tip20Abi,
} from "../tempo/index.js";
import type { AccountProfile, DeploymentRecord } from "../state/index.js";
import type { ReplContext } from "../repl/context.js";
import { recordHistory } from "./history.js";

type Output = Pick<NodeJS.WritableStream, "write">;
type KnownTokenSymbol = "USDV" | "pathUSD";

interface ResolvedToken {
  symbol: KnownTokenSymbol;
  address: Address;
}

interface MemoResult {
  value: Hex;
  source: string;
  hashed: boolean;
}

export async function handleBalanceCommand(args: string[], context: ReplContext, output: Output): Promise<void> {
  const firstArg = args[0];
  const target = firstArg && !isKnownToken(firstArg)
    ? resolveAddress(firstArg, context.accounts)
    : activeProfileAsResolvedAddress(context.activeProfile);
  const tokenArg = firstArg && isKnownToken(firstArg) ? firstArg : args[1];
  const tokens = resolveBalanceTokens(tokenArg, context);

  output.write(`balances for ${target.label} ${target.address}\n`);

  for (const token of tokens) {
    const balance = await context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [target.address],
    });

    output.write(`${token.symbol}: ${formatTip20Amount(balance)}\n`);
  }
}

export async function handleSendCommand(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const parsed = parseSendArgs(args);
  const token = resolveToken(parsed.symbol, context);
  const recipient = resolveAddress(parsed.recipient, context.accounts);
  const amount = parsePositiveTip20Amount(parsed.amount);
  const memo = createTransferMemo(parsed.memo);
  const [senderBalanceBefore, recipientBalanceBefore, totalSupplyBefore] = await Promise.all([
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [recipient.address],
    }),
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);

  if (senderBalanceBefore < amount) {
    throw new Error(`Insufficient ${token.symbol}. Balance=${formatTip20Amount(senderBalanceBefore)}, required=${formatTip20Amount(amount)}.`);
  }

  const walletClient = createTempoWalletClient(active, context.network);

  // Tempo TIP-20 memos are exactly 32 bytes. createTransferMemo packs short labels and hashes longer ones.
  let hash: Hex;

  try {
    hash = await walletClient.writeContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "transferWithMemo",
      args: [recipient.address, amount, memo.value],
    });

    await context.publicClient.waitForTransactionReceipt({ hash });
  } catch (error) {
    if (isPolicyForbidsError(error)) {
      throw createPolicyBlockedTransferError(active, recipient, token);
    }

    throw error;
  }

  const [senderBalanceAfter, recipientBalanceAfter, totalSupplyAfter] = await Promise.all([
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [recipient.address],
    }),
    context.publicClient.readContract({
      address: token.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);
  const sameAddress = addressesEqual(active.address, recipient.address);
  const feeUsesSentToken = context.network.feeToken
    ? addressesEqual(context.network.feeToken, token.address)
    : false;
  const expectedSenderBalance = sameAddress ? senderBalanceBefore : senderBalanceBefore - amount;
  const expectedRecipientBalance = sameAddress ? recipientBalanceBefore : recipientBalanceBefore + amount;
  const senderDeltaMatches = feeUsesSentToken || senderBalanceAfter === expectedSenderBalance;
  const recipientDeltaMatches = recipientBalanceAfter === expectedRecipientBalance;
  const supplyDeltaMatches = totalSupplyAfter === totalSupplyBefore;

  await recordHistory(context, {
    action: "send",
    summary: `sent ${formatTip20Amount(amount)} ${token.symbol} to ${recipient.label}`,
    txs: [{ label: "transfer", hash }],
    metadata: {
      token: token.address,
      to: recipient.address,
      amount: formatTip20Amount(amount),
      memo: memo.value,
    },
  });

  output.write(`sent ${formatTip20Amount(amount)} ${token.symbol} to ${recipient.label} ${recipient.address}\n`);
  output.write(`memo: ${memo.value}\n`);

  if (memo.hashed) {
    output.write(`memo source hashed: ${memo.source}\n`);
  }

  output.write(`${active.name} ${token.symbol}: ${formatTip20Amount(senderBalanceAfter)}\n`);
  output.write(`${recipient.label} ${token.symbol}: ${formatTip20Amount(recipientBalanceAfter)}\n`);
  output.write(`${token.symbol} total supply: ${formatTip20Amount(totalSupplyAfter)}\n`);

  if (!senderDeltaMatches || !recipientDeltaMatches || !supplyDeltaMatches) {
    output.write("warning: post-transfer accounting did not match a simple balance move; check receive policies, fees, or later transactions.\n");
  }

  output.write(`tx: ${hash}\n`);
}

function parseSendArgs(args: string[]): { amount: string; symbol: string; recipient: string; memo?: string } {
  const toIndex = args.indexOf("to");
  const recipient = args[toIndex + 1];

  if (!args[0] || !args[1] || toIndex !== 2 || !recipient) {
    throw new Error("Usage: send <amount> <USDV|pathUSD> to <profile|address> [--memo <text>]");
  }

  const parsed: { amount: string; symbol: string; recipient: string; memo?: string } = {
    amount: args[0],
    symbol: args[1],
    recipient,
  };
  const memo = readOption(args, "--memo");

  if (memo) {
    parsed.memo = memo;
  }

  return parsed;
}

function resolveBalanceTokens(tokenArg: string | undefined, context: ReplContext): ResolvedToken[] {
  if (tokenArg && tokenArg.toLowerCase() !== "all") {
    return [resolveToken(tokenArg, context)];
  }

  return [
    resolveToken("USDV", context),
    resolveToken("pathUSD", context),
  ];
}

function resolveToken(value: string, context: ReplContext): ResolvedToken {
  const normalized = normalizeTokenSymbol(value);

  if (normalized === "USDV") {
    const token = requireTokenDeployment("USDV", context);
    return {
      symbol: "USDV",
      address: token.address,
    };
  }

  if (normalized === "pathUSD") {
    return {
      symbol: "pathUSD",
      address: TESTNET_TIP20_TOKENS.pathUSD,
    };
  }

  throw new Error(`Unknown token: ${value}. Use USDV or pathUSD.`);
}

function normalizeTokenSymbol(value: string): KnownTokenSymbol | undefined {
  const normalized = value.trim().toLowerCase();

  if (normalized === "usdv") {
    return "USDV";
  }

  if (normalized === "pathusd" || normalized === "path-usd") {
    return "pathUSD";
  }

  return undefined;
}

function isKnownToken(value: string): boolean {
  return normalizeTokenSymbol(value) !== undefined;
}

function requireTokenDeployment(symbol: "USDV", context: ReplContext): DeploymentRecord {
  const token = context.deployments.deployments[symbol.toLowerCase()];

  if (!token || token.kind !== "tip20") {
    throw new Error(`Missing ${symbol} deployment. Run token create-usdv first.`);
  }

  return token;
}

function createTransferMemo(input: string | undefined): MemoResult {
  const source = input ?? `send:${Date.now().toString(36)}`;
  const rawHex = stringToHex(source);
  const rawByteLength = (rawHex.length - 2) / 2;

  if (rawByteLength <= 32) {
    return {
      value: padHex(rawHex, { dir: "right", size: 32 }),
      source,
      hashed: false,
    };
  }

  return {
    value: keccak256(toBytes(source)),
    source,
    hashed: true,
  };
}

function activeProfileAsResolvedAddress(activeProfile: AccountProfile | undefined): ResolvedAddress {
  if (!activeProfile) {
    throw new Error("No active profile. Use: use alice");
  }

  return {
    label: activeProfile.name,
    address: activeProfile.address,
    isKnownProfile: true,
  };
}

function requireActiveProfile(context: Pick<ReplContext, "activeProfile">): AccountProfile {
  if (!context.activeProfile) {
    throw new Error("No active profile. Use: use alice");
  }

  return context.activeProfile;
}

function parsePositiveTip20Amount(value: string): bigint {
  const amount = parseTip20Amount(value);

  if (amount <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }

  return amount;
}

function readOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function createPolicyBlockedTransferError(
  sender: AccountProfile,
  recipient: ResolvedAddress,
  token: ResolvedToken,
): Error {
  const restoreHint = recipient.isKnownProfile
    ? `For whitelist policies, restore with: policy allow ${sender.name} or policy allow ${recipient.label}`
    : `For whitelist policies, restore with: policy allow ${sender.name} or policy allow ${recipient.address}`;

  return new Error([
    `TIP-403 policy blocked this ${token.symbol} transfer (PolicyForbids).`,
    "The chain rejected transferWithMemo because the token policy did not authorize the sender or recipient.",
    `sender: ${sender.name} ${sender.address}`,
    `recipient: ${recipient.label} ${recipient.address}`,
    `Check sender: policy check ${sender.name}`,
    `Check recipient: policy check ${recipient.isKnownProfile ? recipient.label : recipient.address}`,
    restoreHint,
  ].join("\n"));
}

function addressesEqual(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
