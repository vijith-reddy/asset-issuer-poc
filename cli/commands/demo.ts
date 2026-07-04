import { keccak256, padHex, stringToHex, toBytes, type Address, type Hex } from "viem";
import { resolveAddress } from "../utils/address-book.js";
import { formatTip20Amount, parseTip20Amount } from "../utils/amount.js";
import {
  createTempoWalletClient,
  tip20Abi,
  tip403RegistryAbi,
  TIP403_REGISTRY_ADDRESS,
} from "../tempo/index.js";
import type { AccountProfile, DeploymentRecord } from "../state/index.js";
import type { ReplContext } from "../repl/context.js";
import { recordHistory } from "./history.js";

type Output = Pick<NodeJS.WritableStream, "write">;

export async function handleDemoCommand(args: string[], context: ReplContext, output: Output): Promise<void> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "help") {
    writeDemoHelp(output);
    return;
  }

  if (subcommand === "policy-failure") {
    await demoPolicyFailure(rest, context, output);
    return;
  }

  output.write(`Unknown demo command: ${subcommand}\n`);
  writeDemoHelp(output);
}

function writeDemoHelp(output: Output): void {
  output.write(`Demo commands:
  demo policy-failure [recipient] [amount]
      Try a USDV transfer that should fail because the recipient is not in the TIP-403 whitelist.
      Defaults: recipient=treasury amount=0.1
`);
}

async function demoPolicyFailure(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const recipient = resolveAddress(args[0] ?? "treasury", context.accounts);
  const amountArg = args[1] ?? "0.1";
  const amount = parsePositiveTip20Amount(amountArg);
  const usdv = requireTokenDeployment("USDV", context);
  const policyId = await context.publicClient.readContract({
    address: usdv.address,
    abi: tip20Abi,
    functionName: "transferPolicyId",
  });
  const [senderAuthorized, recipientAuthorized, balance] = await Promise.all([
    context.publicClient.readContract({
      address: TIP403_REGISTRY_ADDRESS,
      abi: tip403RegistryAbi,
      functionName: "isAuthorized",
      args: [policyId, active.address],
    }),
    context.publicClient.readContract({
      address: TIP403_REGISTRY_ADDRESS,
      abi: tip403RegistryAbi,
      functionName: "isAuthorized",
      args: [policyId, recipient.address],
    }),
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
  ]);

  output.write(`USDV policy id: ${policyId}\n`);
  output.write(`${active.name} authorized: ${senderAuthorized ? "yes" : "no"}\n`);
  output.write(`${recipient.label} authorized: ${recipientAuthorized ? "yes" : "no"}\n`);

  if (!senderAuthorized) {
    throw new Error(`Active profile ${active.name} is not authorized, so this demo would not isolate recipient blocking.`);
  }

  if (recipientAuthorized) {
    throw new Error(`${recipient.label} is already authorized. Use an unallowlisted recipient, like treasury.`);
  }

  if (balance < amount) {
    throw new Error(`Insufficient USDV for demo. Balance=${formatTip20Amount(balance)}, required=${formatTip20Amount(amount)}.`);
  }

  const walletClient = createTempoWalletClient(active, context.network);
  const memo = createDemoMemo(`policy-failure:${active.name}->${recipient.label}:${amountArg}`);

  try {
    const hash = await walletClient.writeContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "transferWithMemo",
      args: [recipient.address, amount, memo],
    });
    await context.publicClient.waitForTransactionReceipt({ hash });
    throw new Error(`Policy failure demo unexpectedly succeeded. tx=${hash}`);
  } catch (error) {
    const message = summarizeError(error);

    if (!message.includes("PolicyForbids")) {
      throw error;
    }

    output.write(`expected failure: USDV policy blocked transfer to ${recipient.label}\n`);
    output.write("reason: PolicyForbids\n");

    await recordHistory(context, {
      action: "demo policy-failure",
      status: "expected-failure",
      summary: `USDV transfer to ${recipient.label} was blocked by TIP-403`,
      error: "PolicyForbids",
      metadata: {
        from: active.address,
        to: recipient.address,
        token: usdv.address,
        amount: formatTip20Amount(amount),
        policyId: policyId.toString(),
        memo,
      },
    });
  }
}

function requireActiveProfile(context: ReplContext): AccountProfile {
  if (!context.activeProfile) {
    throw new Error("No active profile. Use: use alice");
  }

  return context.activeProfile;
}

function requireTokenDeployment(symbol: "USDV", context: ReplContext): DeploymentRecord {
  const token = context.deployments.deployments[symbol.toLowerCase()];

  if (!token || token.kind !== "tip20") {
    throw new Error(`Missing ${symbol} deployment. Run token create-usdv first.`);
  }

  return token;
}

function parsePositiveTip20Amount(value: string): bigint {
  const amount = parseTip20Amount(value);

  if (amount <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }

  return amount;
}

function createDemoMemo(source: string): Hex {
  const rawHex = stringToHex(source);
  const rawByteLength = (rawHex.length - 2) / 2;

  if (rawByteLength <= 32) {
    return padHex(rawHex, { dir: "right", size: 32 });
  }

  return keccak256(toBytes(source));
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
