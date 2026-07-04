import { keccak256, toBytes, type Abi, type Address, type Hex } from "viem";
import { resolveAddress } from "../utils/address-book.js";
import { formatTip20Amount, parseTip20Amount } from "../utils/amount.js";
import {
  createTempoWalletClient,
  fundAddressFromTempoFaucet,
  loadManagerArtifact,
  TESTNET_TIP20_TOKENS,
  tip20Abi,
  tip403RegistryAbi,
  TIP403_REGISTRY_ADDRESS,
} from "../tempo/index.js";
import { nowIso, type AccountProfile, type DeploymentRecord, type Hash } from "../state/index.js";
import type { ReplContext } from "../repl/context.js";
import { recordHistory } from "./history.js";
import {
  formatNoActivePolicyMessage,
  formatUnknownPolicyMessage,
} from "../utils/policy-hints.js";
import {
  TIP20_MANAGER_OPERATIONAL_ROLE_NAMES,
  getTip20RoleDefinition,
  type Tip20RoleDefinition,
} from "../utils/tip20-roles.js";

type Output = Pick<NodeJS.WritableStream, "write">;

interface TracePreference {
  enabled: boolean;
}

export async function handleManagerCommand(args: string[], context: ReplContext, output: Output): Promise<void> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "help") {
    writeManagerHelp(output);
    return;
  }

  if (subcommand === "deploy") {
    await deployManager(rest, context, output);
    return;
  }

  if (subcommand === "inspect") {
    await inspectManager(context, output);
    return;
  }

  if (subcommand === "grant-issuer") {
    await grantIssuer(context, output);
    return;
  }

  if (subcommand === "grant-operational-roles") {
    await grantOperationalRoles(context, output);
    return;
  }

  if (subcommand === "allow-policy") {
    await allowManagerInPolicy(rest[0], context, output);
    return;
  }

  if (subcommand === "faucet") {
    await faucetManager(context, output);
    return;
  }

  if (subcommand === "subscribe") {
    await subscribe(rest, context, output);
    return;
  }

  if (subcommand === "redeem") {
    await redeem(rest, context, output);
    return;
  }

  if (subcommand === "admin-subscribe") {
    await adminSubscribe(rest, context, output);
    return;
  }

  output.write(`Unknown manager command: ${subcommand}\n`);
  writeManagerHelp(output);
}

function writeManagerHelp(output: Output): void {
  output.write(`Manager commands:
  manager deploy [--admin <profile|address>]
  manager inspect
  manager grant-issuer
  manager grant-operational-roles
  manager allow-policy [policy-name]
  manager faucet
  manager subscribe <amount> [--min <amount>] [--trace|--no-trace]
  manager redeem <amount> [--min <amount>] [--trace|--no-trace]
  manager admin-subscribe <recipient> <amount> [--min <amount>] [--memo <text>] [--trace|--no-trace]
`);
}

async function deployManager(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);

  if (context.deployments.deployments.manager) {
    throw new Error("Manager already exists in local deployment state.");
  }

  const usdv = requireDeployment("usdv", context);
  const adminArg = readOption(args, "--admin");
  const admin = adminArg ? resolveAddress(adminArg, context.accounts) : {
    label: active.name,
    address: active.address,
    isKnownProfile: true,
  };
  const artifact = await loadManagerArtifact();
  const walletClient = createTempoWalletClient(active, context.network);
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [usdv.address, TESTNET_TIP20_TOKENS.pathUSD, admin.address],
  });
  const receipt = await context.publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error("Manager deployment receipt did not include a contract address.");
  }

  const createdAt = nowIso();
  const record: DeploymentRecord = {
    name: "manager",
    address: receipt.contractAddress,
    network: context.network.key,
    kind: "manager",
    txHash: hash,
    createdAt,
    metadata: {
      usdv: usdv.address,
      settlementToken: TESTNET_TIP20_TOKENS.pathUSD,
      admin: admin.label,
    },
  };

  context.deployments.deployments.manager = record;
  context.deployments.updatedAt = createdAt;
  await context.saveDeployments(context.deployments);
  await recordHistory(context, {
    action: "manager deploy",
    summary: `deployed manager ${record.address}`,
    txs: [{ label: "deploy", hash }],
    metadata: {
      manager: record.address,
      usdv: usdv.address,
      settlementToken: TESTNET_TIP20_TOKENS.pathUSD,
      admin: admin.address,
    },
  });

  output.write(`deployed manager ${record.address}\n`);
  output.write(`usdv ${usdv.address}\n`);
  output.write(`settlement pathUSD ${TESTNET_TIP20_TOKENS.pathUSD}\n`);
  output.write(`admin ${admin.label} ${admin.address}\n`);
  output.write(`tx: ${hash}\n`);
}

async function inspectManager(context: ReplContext, output: Output): Promise<void> {
  const manager = requireDeployment("manager", context);
  const artifact = await loadManagerArtifact();
  const [usdv, settlementToken, admin] = await Promise.all([
    context.publicClient.readContract({
      address: manager.address,
      abi: artifact.abi,
      functionName: "usdv",
    }),
    context.publicClient.readContract({
      address: manager.address,
      abi: artifact.abi,
      functionName: "settlementToken",
    }),
    context.publicClient.readContract({
      address: manager.address,
      abi: artifact.abi,
      functionName: "admin",
    }),
  ]);

  output.write(`manager: ${manager.address}\n`);
  output.write(`usdv: ${usdv}\n`);
  output.write(`settlement token: ${settlementToken}\n`);
  output.write(`admin: ${admin}\n`);
}

async function grantIssuer(context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const manager = requireDeployment("manager", context);
  const usdv = requireDeployment("usdv", context);
  const walletClient = createTempoWalletClient(active, context.network);
  const issuerRole = await context.publicClient.readContract({
    address: usdv.address,
    abi: tip20Abi,
    functionName: "ISSUER_ROLE",
  });
  const hash = await walletClient.writeContract({
    address: usdv.address,
    abi: tip20Abi,
    functionName: "grantRole",
    args: [issuerRole, manager.address],
  });

  await context.publicClient.waitForTransactionReceipt({ hash });

  manager.metadata = {
    ...(manager.metadata ?? {}),
    issuerRoleGrantedOn: usdv.address,
    issuerRoleTx: hash,
  };
  context.deployments.updatedAt = nowIso();
  await context.saveDeployments(context.deployments);
  await recordHistory(context, {
    action: "manager grant-issuer",
    summary: `granted USDV issuer role to manager`,
    txs: [{ label: "grantRole", hash }],
    metadata: {
      usdv: usdv.address,
      manager: manager.address,
      role: issuerRole,
    },
  });

  output.write(`granted ISSUER_ROLE on USDV to manager ${manager.address}\n`);
  output.write(`tx: ${hash}\n`);
}

async function grantOperationalRoles(context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const manager = requireDeployment("manager", context);
  const usdv = requireDeployment("usdv", context);
  const walletClient = createTempoWalletClient(active, context.network);
  const txs: { label: string; hash: Hash }[] = [];

  for (const roleName of TIP20_MANAGER_OPERATIONAL_ROLE_NAMES) {
    const role = getTip20RoleDefinition(roleName);
    const roleId = await readRoleId(usdv, role, context);
    const alreadyGranted = await context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "hasRole",
      args: [manager.address, roleId],
    });

    if (alreadyGranted) {
      output.write(`manager already has ${role.displayName}\n`);
      continue;
    }

    const hash = await walletClient.writeContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "grantRole",
      args: [roleId, manager.address],
    });
    await context.publicClient.waitForTransactionReceipt({ hash });

    txs.push({ label: `grant ${role.displayName}`, hash });
    output.write(`granted ${role.displayName} to manager\n`);
  }

  usdv.metadata = {
    ...(usdv.metadata ?? {}),
    managerOperationalRoles: TIP20_MANAGER_OPERATIONAL_ROLE_NAMES.join(","),
    managerOperationalRolesGrantedTo: manager.address,
    managerOperationalRolesUpdatedAt: nowIso(),
  };
  manager.metadata = {
    ...(manager.metadata ?? {}),
    operationalRolesGrantedOn: usdv.address,
    operationalRoles: TIP20_MANAGER_OPERATIONAL_ROLE_NAMES.join(","),
  };
  context.deployments.updatedAt = nowIso();
  await context.saveDeployments(context.deployments);

  if (txs.length > 0) {
    await recordHistory(context, {
      action: "manager grant-operational-roles",
      summary: `granted ${txs.length} operational role(s) to manager`,
      txs,
      metadata: {
        usdv: usdv.address,
        manager: manager.address,
        roles: TIP20_MANAGER_OPERATIONAL_ROLE_NAMES.join(","),
      },
    });
  }

  output.write(`manager operational roles ready on USDV ${usdv.address}\n`);
  output.write(`manager: ${manager.address}\n`);
}

async function allowManagerInPolicy(policyName: string | undefined, context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const manager = requireDeployment("manager", context);
  const policy = requirePolicy(policyName ?? context.session.activePolicy, context);
  const walletClient = createTempoWalletClient(active, context.network);
  const hash = policy.type === "whitelist"
    ? await walletClient.writeContract({
      address: TIP403_REGISTRY_ADDRESS,
      abi: tip403RegistryAbi,
      functionName: "modifyPolicyWhitelist",
      args: [BigInt(policy.id), manager.address, true],
    })
    : await walletClient.writeContract({
      address: TIP403_REGISTRY_ADDRESS,
      abi: tip403RegistryAbi,
      functionName: "modifyPolicyBlacklist",
      args: [BigInt(policy.id), manager.address, false],
    });

  await context.publicClient.waitForTransactionReceipt({ hash });

  policy.members.manager = {
    name: "manager",
    address: manager.address,
    included: policy.type === "whitelist",
    updatedAt: nowIso(),
  };
  context.policies.updatedAt = nowIso();
  await context.savePolicies(context.policies);
  await recordHistory(context, {
    action: "manager allow-policy",
    summary: `authorized manager in policy ${policy.name}`,
    txs: [{ label: policy.type === "whitelist" ? "modifyPolicyWhitelist" : "modifyPolicyBlacklist", hash }],
    metadata: {
      policy: policy.name,
      policyId: policy.id,
      manager: manager.address,
    },
  });

  output.write(`manager authorized for policy ${policy.name}\n`);
  output.write(`tx: ${hash}\n`);
}

async function faucetManager(context: ReplContext, output: Output): Promise<void> {
  const manager = requireDeployment("manager", context);
  const result = await fundAddressFromTempoFaucet(manager.address);

  if (!result.ok) {
    throw new Error(`Faucet funding failed (${result.status}): ${result.body}`);
  }

  output.write(`funded manager ${manager.address}\n`);
}

async function subscribe(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const manager = requireDeployment("manager", context);
  const usdv = requireDeployment("usdv", context);
  const amount = parseRequiredAmount(args[0], "manager subscribe <amount>");
  const minOut = parseTip20Amount(readOption(args, "--min") ?? args[0] ?? "0");
  const trace = resolveTracePreference(args, context);
  const walletClient = createTempoWalletClient(active, context.network);
  const artifact = await loadManagerArtifact();
  const [pathUsdBefore, usdvBefore, totalSupplyBefore] = await Promise.all([
    context.publicClient.readContract({
      address: TESTNET_TIP20_TOKENS.pathUSD,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);

  if (pathUsdBefore < amount) {
    throw new Error(`Insufficient pathUSD. Balance=${formatTip20Amount(pathUsdBefore)}, required=${formatTip20Amount(amount)}.`);
  }

  const approveHash = await walletClient.writeContract({
    address: TESTNET_TIP20_TOKENS.pathUSD,
    abi: tip20Abi,
    functionName: "approve",
    args: [manager.address, amount],
  });
  await context.publicClient.waitForTransactionReceipt({ hash: approveHash });

  const subscribeHash = await walletClient.writeContract({
    address: manager.address,
    abi: artifact.abi,
    functionName: "subscribe",
    args: [TESTNET_TIP20_TOKENS.pathUSD, amount, minOut],
  });
  await context.publicClient.waitForTransactionReceipt({ hash: subscribeHash });
  const [pathUsdAfter, usdvAfter, totalSupplyAfter] = await Promise.all([
    context.publicClient.readContract({
      address: TESTNET_TIP20_TOKENS.pathUSD,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);
  const mintMatches = usdvAfter === usdvBefore + amount;
  const supplyMatches = totalSupplyAfter === totalSupplyBefore + amount;

  await recordHistory(context, {
    action: "subscribe",
    summary: `subscribed ${formatTip20Amount(amount)} pathUSD for USDV`,
    txs: [
      { label: "approve pathUSD", hash: approveHash },
      { label: "subscribe", hash: subscribeHash },
    ],
    metadata: {
      manager: manager.address,
      amount: formatTip20Amount(amount),
    },
  });

  output.write(`subscribed ${formatTip20Amount(amount)} pathUSD for USDV\n`);
  output.write(`${active.name} USDV: ${formatTip20Amount(usdvAfter)}\n`);
  output.write(`${active.name} pathUSD: ${formatTip20Amount(pathUsdAfter)}\n`);
  output.write(`USDV total supply: ${formatTip20Amount(totalSupplyAfter)}\n`);

  if (!mintMatches || !supplyMatches) {
    output.write("warning: post-subscribe accounting did not match a clean mint; inspect the subscribe transaction before continuing.\n");
  }

  if (trace.enabled) {
    writeSubscribeTrace(output, {
      active,
      manager,
      usdv,
      amount,
      minOut,
      pathUsdBefore,
      pathUsdAfter,
      usdvBefore,
      usdvAfter,
      totalSupplyBefore,
      totalSupplyAfter,
      approveHash,
      subscribeHash,
    });
  }

  output.write(`approve tx: ${approveHash}\n`);
  output.write(`subscribe tx: ${subscribeHash}\n`);
}

async function redeem(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const manager = requireDeployment("manager", context);
  const usdv = requireDeployment("usdv", context);
  const amount = parseRequiredAmount(args[0], "manager redeem <amount>");
  const minOut = parseTip20Amount(readOption(args, "--min") ?? args[0] ?? "0");
  const trace = resolveTracePreference(args, context);
  const walletClient = createTempoWalletClient(active, context.network);
  const artifact = await loadManagerArtifact();
  const [userUsdvBefore, userPathUsdBefore, totalSupplyBefore] = await Promise.all([
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: TESTNET_TIP20_TOKENS.pathUSD,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);

  if (userUsdvBefore < amount) {
    throw new Error(`Insufficient USDV. Balance=${formatTip20Amount(userUsdvBefore)}, required=${formatTip20Amount(amount)}.`);
  }

  const approveHash = await walletClient.writeContract({
    address: usdv.address,
    abi: tip20Abi,
    functionName: "approve",
    args: [manager.address, amount],
  });
  await context.publicClient.waitForTransactionReceipt({ hash: approveHash });

  const redeemHash = await walletClient.writeContract({
    address: manager.address,
    abi: artifact.abi,
    functionName: "redeem",
    args: [amount, TESTNET_TIP20_TOKENS.pathUSD, minOut],
  });
  await context.publicClient.waitForTransactionReceipt({ hash: redeemHash });
  const [userUsdvAfter, userPathUsdAfter, managerUsdvAfter, totalSupplyAfter] = await Promise.all([
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: TESTNET_TIP20_TOKENS.pathUSD,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [manager.address],
    }),
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);
  const userBurnMatches = userUsdvAfter === userUsdvBefore - amount;
  const supplyBurnMatches = totalSupplyAfter + amount === totalSupplyBefore;
  const managerCleared = managerUsdvAfter === 0n;

  await recordHistory(context, {
    action: "redeem",
    summary: `redeemed ${formatTip20Amount(amount)} USDV for pathUSD`,
    txs: [
      { label: "approve USDV", hash: approveHash },
      { label: "redeem", hash: redeemHash },
    ],
    metadata: {
      manager: manager.address,
      amount: formatTip20Amount(amount),
    },
  });

  output.write(`redeemed ${formatTip20Amount(amount)} USDV for pathUSD\n`);
  output.write(`${active.name} USDV: ${formatTip20Amount(userUsdvAfter)}\n`);
  output.write(`${active.name} pathUSD: ${formatTip20Amount(userPathUsdAfter)}\n`);
  output.write(`manager USDV: ${formatTip20Amount(managerUsdvAfter)}\n`);
  output.write(`USDV total supply: ${formatTip20Amount(totalSupplyAfter)}\n`);

  if (!userBurnMatches || !supplyBurnMatches || !managerCleared) {
    output.write("warning: post-redeem accounting did not match a clean burn; inspect the redeem transaction before continuing.\n");
  }

  if (trace.enabled) {
    writeRedeemTrace(output, {
      active,
      manager,
      usdv,
      amount,
      minOut,
      userUsdvBefore,
      userUsdvAfter,
      userPathUsdBefore,
      userPathUsdAfter,
      managerUsdvAfter,
      totalSupplyBefore,
      totalSupplyAfter,
      approveHash,
      redeemHash,
    });
  }

  output.write(`approve tx: ${approveHash}\n`);
  output.write(`redeem tx: ${redeemHash}\n`);
}

async function adminSubscribe(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const manager = requireDeployment("manager", context);
  const usdv = requireDeployment("usdv", context);
  const [recipientArg, amountArg] = args;

  if (!recipientArg || !amountArg) {
    output.write("Usage: manager admin-subscribe <recipient> <amount> [--min <amount>] [--memo <text>]\n");
    return;
  }

  const recipient = resolveAddress(recipientArg, context.accounts);
  const amount = parseTip20Amount(amountArg);
  const minOut = parseTip20Amount(readOption(args, "--min") ?? amountArg);
  const trace = resolveTracePreference(args, context);
  const memo = keccak256(toBytes(readOption(args, "--memo") ?? `ADMIN_SUBSCRIBE:${recipient.label}:${amountArg}`));
  const walletClient = createTempoWalletClient(active, context.network);
  const artifact = await loadManagerArtifact();
  const [recipientUsdvBefore, totalSupplyBefore] = await Promise.all([
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [recipient.address],
    }),
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);
  const hash = await walletClient.writeContract({
    address: manager.address,
    abi: artifact.abi,
    functionName: "adminSubscribe",
    args: [recipient.address, amount, minOut, memo],
  });
  await context.publicClient.waitForTransactionReceipt({ hash });
  const [recipientUsdvAfter, totalSupplyAfter] = await Promise.all([
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [recipient.address],
    }),
    context.publicClient.readContract({
      address: usdv.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);
  const mintMatches = recipientUsdvAfter === recipientUsdvBefore + amount;
  const supplyMatches = totalSupplyAfter === totalSupplyBefore + amount;

  await recordHistory(context, {
    action: "admin-subscribe",
    summary: `admin subscribed ${recipient.label} for ${formatTip20Amount(amount)} USDV`,
    txs: [{ label: "adminSubscribe", hash }],
    metadata: {
      manager: manager.address,
      recipient: recipient.address,
      amount: formatTip20Amount(amount),
      memo,
    },
  });

  output.write(`admin subscribed ${recipient.label} for ${formatTip20Amount(amount)} USDV\n`);
  output.write(`${recipient.label} USDV: ${formatTip20Amount(recipientUsdvAfter)}\n`);
  output.write(`USDV total supply: ${formatTip20Amount(totalSupplyAfter)}\n`);

  if (!mintMatches || !supplyMatches) {
    output.write("warning: post-admin-subscribe accounting did not match a clean mint; inspect the transaction before continuing.\n");
  }

  if (trace.enabled) {
    writeAdminSubscribeTrace(output, {
      active,
      manager,
      usdv,
      recipientLabel: recipient.label,
      recipientAddress: recipient.address,
      amount,
      minOut,
      memo,
      recipientUsdvBefore,
      recipientUsdvAfter,
      totalSupplyBefore,
      totalSupplyAfter,
      hash,
    });
  }

  output.write(`memo: ${memo}\n`);
  output.write(`tx: ${hash}\n`);
}

function resolveTracePreference(args: string[], context: ReplContext): TracePreference {
  const forceTrace = args.includes("--trace");
  const suppressTrace = args.includes("--no-trace");

  if (forceTrace && suppressTrace) {
    throw new Error("Use either --trace or --no-trace, not both.");
  }

  return {
    enabled: forceTrace || (!suppressTrace && (context.session.traceEnabled ?? true)),
  };
}

// These traces are business-level call explanations, not raw EVM execution traces.
// The goal is to show who signs, which contract receives the tx, and why TIP-20 mint/burn is allowed.
function writeSubscribeTrace(
  output: Output,
  params: {
    active: AccountProfile;
    manager: DeploymentRecord;
    usdv: DeploymentRecord;
    amount: bigint;
    minOut: bigint;
    pathUsdBefore: bigint;
    pathUsdAfter: bigint;
    usdvBefore: bigint;
    usdvAfter: bigint;
    totalSupplyBefore: bigint;
    totalSupplyAfter: bigint;
    approveHash: Hash;
    subscribeHash: Hash;
  },
): void {
  output.write("trace:\n");
  output.write(`  1. CLI route: subscribe ${formatTip20Amount(params.amount)} -> manager subscribe ${formatTip20Amount(params.amount)}\n`);
  output.write(`  2. signer: ${params.active.name} ${params.active.address}\n`);
  output.write(`  3. approve: pathUSD.approve(manager, ${formatTip20Amount(params.amount)})\n`);
  output.write(`     token: ${TESTNET_TIP20_TOKENS.pathUSD}\n`);
  output.write(`     spender: ${params.manager.address}\n`);
  output.write(`     tx: ${params.approveHash}\n`);
  output.write(`  4. call: manager.subscribe(pathUSD, ${formatTip20Amount(params.amount)}, min ${formatTip20Amount(params.minOut)})\n`);
  output.write(`     manager: ${params.manager.address}\n`);
  output.write(`     tx: ${params.subscribeHash}\n`);
  output.write("  5. manager flow:\n");
  output.write(`     - pulls ${formatTip20Amount(params.amount)} pathUSD from ${params.active.name} with transferFrom\n`);
  output.write(`     - external TIP-20 call: USDV.mintWithMemo(${params.active.name}, ${formatTip20Amount(params.amount)}, memo)\n`);
  output.write(`     - permission: ${describeIssuerRole(params.manager, params.usdv)}\n`);
  output.write("  6. result:\n");
  output.write(`     - ${params.active.name} pathUSD: ${formatTip20Amount(params.pathUsdBefore)} -> ${formatTip20Amount(params.pathUsdAfter)} (includes Tempo fees)\n`);
  output.write(`     - ${params.active.name} USDV: ${formatTip20Amount(params.usdvBefore)} -> ${formatTip20Amount(params.usdvAfter)}\n`);
  output.write(`     - USDV total supply: ${formatTip20Amount(params.totalSupplyBefore)} -> ${formatTip20Amount(params.totalSupplyAfter)}\n`);
}

function writeRedeemTrace(
  output: Output,
  params: {
    active: AccountProfile;
    manager: DeploymentRecord;
    usdv: DeploymentRecord;
    amount: bigint;
    minOut: bigint;
    userUsdvBefore: bigint;
    userUsdvAfter: bigint;
    userPathUsdBefore: bigint;
    userPathUsdAfter: bigint;
    managerUsdvAfter: bigint;
    totalSupplyBefore: bigint;
    totalSupplyAfter: bigint;
    approveHash: Hash;
    redeemHash: Hash;
  },
): void {
  output.write("trace:\n");
  output.write(`  1. CLI route: redeem ${formatTip20Amount(params.amount)} -> manager redeem ${formatTip20Amount(params.amount)}\n`);
  output.write(`  2. signer: ${params.active.name} ${params.active.address}\n`);
  output.write(`  3. approve: USDV.approve(manager, ${formatTip20Amount(params.amount)})\n`);
  output.write(`     token: ${params.usdv.address}\n`);
  output.write(`     spender: ${params.manager.address}\n`);
  output.write(`     tx: ${params.approveHash}\n`);
  output.write(`  4. call: manager.redeem(${formatTip20Amount(params.amount)}, pathUSD, min ${formatTip20Amount(params.minOut)})\n`);
  output.write(`     manager: ${params.manager.address}\n`);
  output.write(`     tx: ${params.redeemHash}\n`);
  output.write("  5. manager flow:\n");
  output.write(`     - pulls ${formatTip20Amount(params.amount)} USDV from ${params.active.name} with transferFrom\n`);
  output.write(`     - external TIP-20 call: USDV.burnWithMemo(${formatTip20Amount(params.amount)}, memo)\n`);
  output.write(`     - permission: ${describeIssuerRole(params.manager, params.usdv)}\n`);
  output.write(`     - sends ${formatTip20Amount(params.amount)} pathUSD back to ${params.active.name}\n`);
  output.write("  6. result:\n");
  output.write(`     - ${params.active.name} USDV: ${formatTip20Amount(params.userUsdvBefore)} -> ${formatTip20Amount(params.userUsdvAfter)}\n`);
  output.write(`     - ${params.active.name} pathUSD: ${formatTip20Amount(params.userPathUsdBefore)} -> ${formatTip20Amount(params.userPathUsdAfter)} (includes Tempo fees)\n`);
  output.write(`     - manager USDV: ${formatTip20Amount(params.managerUsdvAfter)}\n`);
  output.write(`     - USDV total supply: ${formatTip20Amount(params.totalSupplyBefore)} -> ${formatTip20Amount(params.totalSupplyAfter)}\n`);
}

function writeAdminSubscribeTrace(
  output: Output,
  params: {
    active: AccountProfile;
    manager: DeploymentRecord;
    usdv: DeploymentRecord;
    recipientLabel: string;
    recipientAddress: Address;
    amount: bigint;
    minOut: bigint;
    memo: Hex;
    recipientUsdvBefore: bigint;
    recipientUsdvAfter: bigint;
    totalSupplyBefore: bigint;
    totalSupplyAfter: bigint;
    hash: Hash;
  },
): void {
  output.write("trace:\n");
  output.write(`  1. CLI route: admin-subscribe ${params.recipientLabel} ${formatTip20Amount(params.amount)} -> manager admin-subscribe\n`);
  output.write(`  2. signer: ${params.active.name} ${params.active.address}\n`);
  output.write(`  3. call: manager.adminSubscribe(${params.recipientLabel}, ${formatTip20Amount(params.amount)}, min ${formatTip20Amount(params.minOut)}, memo)\n`);
  output.write(`     manager: ${params.manager.address}\n`);
  output.write(`     recipient: ${params.recipientAddress}\n`);
  output.write(`     memo: ${params.memo}\n`);
  output.write(`     tx: ${params.hash}\n`);
  output.write("  4. manager flow:\n");
  output.write("     - no pathUSD is pulled onchain; this models offchain settlement\n");
  output.write(`     - external TIP-20 call: USDV.mintWithMemo(${params.recipientLabel}, ${formatTip20Amount(params.amount)}, memo)\n`);
  output.write(`     - permission: ${describeIssuerRole(params.manager, params.usdv)}\n`);
  output.write("  5. result:\n");
  output.write(`     - ${params.recipientLabel} USDV: ${formatTip20Amount(params.recipientUsdvBefore)} -> ${formatTip20Amount(params.recipientUsdvAfter)}\n`);
  output.write(`     - USDV total supply: ${formatTip20Amount(params.totalSupplyBefore)} -> ${formatTip20Amount(params.totalSupplyAfter)}\n`);
}

function describeIssuerRole(manager: DeploymentRecord, usdv: DeploymentRecord): string {
  if (manager.metadata?.operationalRolesGrantedOn?.toLowerCase() === usdv.address.toLowerCase()) {
    return `manager has operational TIP-20 roles (${manager.metadata.operationalRoles})`;
  }

  if (manager.metadata?.issuerRoleTx && manager.metadata.issuerRoleGrantedOn?.toLowerCase() === usdv.address.toLowerCase()) {
    return `manager has USDV ISSUER_ROLE (grant tx ${manager.metadata.issuerRoleTx})`;
  }

  return "manager must have USDV ISSUER_ROLE; no grant tx is recorded in local state";
}

function requireActiveProfile(context: ReplContext): AccountProfile {
  if (!context.activeProfile) {
    throw new Error("No active profile. Use: use admin");
  }

  return context.activeProfile;
}

function requireDeployment(name: "usdv" | "manager", context: ReplContext): DeploymentRecord {
  const deployment = context.deployments.deployments[name];

  if (!deployment) {
    throw new Error(formatMissingDeploymentMessage(name));
  }

  return deployment;
}

function requirePolicy(name: string | undefined, context: ReplContext) {
  if (!name) {
    throw new Error(formatNoActivePolicyMessage(context.policies));
  }

  const policy = context.policies.policies[name];

  if (!policy) {
    throw new Error(formatUnknownPolicyMessage(name, context.policies));
  }

  return policy;
}

function parseRequiredAmount(value: string | undefined, usage: string): bigint {
  if (!value) {
    throw new Error(`Usage: ${usage}`);
  }

  return parseTip20Amount(value);
}

function readOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function formatMissingDeploymentMessage(name: "usdv" | "manager"): string {
  if (name === "usdv") {
    return [
      "Missing deployment: USDV",
      "Run: token create-usdv",
      "Then attach a policy with: token set-policy USDV <policy-name>",
    ].join("\n");
  }

  return [
    "Missing deployment: manager",
    "Run the manager bootstrap sequence:",
    "manager deploy",
    "manager grant-operational-roles",
    "manager allow-policy <policy-name>",
    "manager faucet",
  ].join("\n");
}

async function readRoleId(
  usdv: DeploymentRecord,
  role: Tip20RoleDefinition,
  context: ReplContext,
): Promise<Hex> {
  return context.publicClient.readContract({
    address: usdv.address,
    abi: tip20Abi,
    functionName: role.functionName,
  });
}
