import { getAddress, isAddress, keccak256, toBytes, type Abi, type Address, type Hex } from "viem";
import { resolveAddress } from "../utils/address-book.js";
import { formatTip20Amount, parseTip20Amount } from "../utils/amount.js";
import {
  createTempoWalletClient,
  fundAddressFromTempoFaucet,
  loadLegacyManagerArtifact,
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
    await grantIssuer(rest, context, output);
    return;
  }

  if (subcommand === "grant-operational-roles") {
    await grantOperationalRoles(rest, context, output);
    return;
  }

  if (subcommand === "register-route") {
    await registerRoute(rest, context, output);
    return;
  }

  if (subcommand === "routes") {
    writeRoutes(context, output);
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
  manager deploy [--admin <profile|address>] [--replace]
  manager inspect
  manager register-route [symbol] [--settlement <pathUSD|address>]
  manager routes
  manager grant-issuer [--asset <symbol>]
  manager grant-operational-roles [--asset <symbol>]
  manager allow-policy [policy-name]
  manager faucet
  manager subscribe <amount> [--asset <symbol>] [--min <amount>] [--trace|--no-trace]
  manager redeem <amount> [--asset <symbol>] [--min <amount>] [--trace|--no-trace]
  manager admin-subscribe <recipient> <amount> [--asset <symbol>] [--min <amount>] [--memo <text>] [--trace|--no-trace]
`);
}

async function deployManager(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const existingManager = context.deployments.deployments.manager;
  const replaceLegacy = args.includes("--replace");

  if (existingManager && isReusableManager(existingManager)) {
    throw new Error("Reusable manager already exists in local deployment state.");
  }

  if (existingManager && !replaceLegacy) {
    throw new Error([
      "Legacy USDV-only manager already exists in local deployment state.",
      "Run: manager deploy --replace",
      "This archives the old local manager record and deploys a reusable multi-asset operator.",
    ].join("\n"));
  }

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
    args: [admin.address],
  });
  const receipt = await context.publicClient.waitForTransactionReceipt({ hash });

  if (!receipt.contractAddress) {
    throw new Error("Manager deployment receipt did not include a contract address.");
  }

  const createdAt = nowIso();

  if (existingManager) {
    const archivedKey = uniqueDeploymentKey(`manager-legacy-${managerAssetSymbol(existingManager, context).toLowerCase()}`, context);
    context.deployments.deployments[archivedKey] = {
      ...existingManager,
      name: archivedKey,
      notes: "Archived USDV-only manager replaced by reusable multi-asset operator.",
      metadata: {
        ...(existingManager.metadata ?? {}),
        archivedAt: createdAt,
        archivedAs: archivedKey,
      },
    };
  }

  const record: DeploymentRecord = {
    name: "manager",
    address: receipt.contractAddress,
    network: context.network.key,
    kind: "manager",
    txHash: hash,
    createdAt,
    metadata: {
      managerVersion: "multi-asset",
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
      settlementToken: TESTNET_TIP20_TOKENS.pathUSD,
      admin: admin.address,
      managerVersion: "multi-asset",
    },
  });

  output.write(`deployed manager ${record.address}\n`);
  output.write("type reusable multi-asset operator\n");
  output.write(`settlement pathUSD ${TESTNET_TIP20_TOKENS.pathUSD}\n`);
  output.write(`admin ${admin.label} ${admin.address}\n`);
  output.write("next: manager register-route <symbol>\n");
  output.write(`tx: ${hash}\n`);
}

async function inspectManager(context: ReplContext, output: Output): Promise<void> {
  const manager = requireDeployment("manager", context);

  if (!isReusableManager(manager)) {
    const artifact = await loadLegacyManagerArtifact();
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
    output.write("type: legacy USDV-only\n");
    output.write(`usdv: ${usdv}\n`);
    output.write(`settlement token: ${settlementToken}\n`);
    output.write(`admin: ${admin}\n`);
    output.write("upgrade: manager deploy --replace\n");
    return;
  }

  const artifact = await loadManagerArtifact();
  const admin = await context.publicClient.readContract({
    address: manager.address,
    abi: artifact.abi,
    functionName: "admin",
  });

  output.write(`manager: ${manager.address}\n`);
  output.write("type: reusable multi-asset\n");
  output.write(`admin: ${admin}\n`);
  writeRoutes(context, output);
}

async function grantIssuer(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const manager = requireDeployment("manager", context);
  const asset = resolveAssetFromArgs(args, context, true);
  const walletClient = createTempoWalletClient(active, context.network);
  const issuerRole = await context.publicClient.readContract({
    address: asset.address,
    abi: tip20Abi,
    functionName: "ISSUER_ROLE",
  });
  const hash = await walletClient.writeContract({
    address: asset.address,
    abi: tip20Abi,
    functionName: "grantRole",
    args: [issuerRole, manager.address],
  });

  await context.publicClient.waitForTransactionReceipt({ hash });

  manager.metadata = {
    ...(manager.metadata ?? {}),
    issuerRoleGrantedOn: asset.address,
    issuerRoleTx: hash,
  };
  asset.metadata = {
    ...(asset.metadata ?? {}),
    "role.issuer.manager.address": manager.address,
    "role.issuer.manager.status": "granted",
    "role.issuer.manager.tx": hash,
  };
  context.deployments.updatedAt = nowIso();
  await context.saveDeployments(context.deployments);
  await recordHistory(context, {
    action: "manager grant-issuer",
    summary: `granted ${asset.name} issuer role to manager`,
    txs: [{ label: "grantRole", hash }],
    metadata: {
      asset: asset.address,
      manager: manager.address,
      role: issuerRole,
    },
  });

  output.write(`granted ISSUER_ROLE on ${asset.name} to manager ${manager.address}\n`);
  output.write(`tx: ${hash}\n`);
}

async function grantOperationalRoles(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const manager = requireDeployment("manager", context);
  const asset = resolveAssetFromArgs(args, context);
  const walletClient = createTempoWalletClient(active, context.network);
  const txs: { label: string; hash: Hash }[] = [];

  for (const roleName of TIP20_MANAGER_OPERATIONAL_ROLE_NAMES) {
    const role = getTip20RoleDefinition(roleName);
    const roleId = await readRoleId(asset, role, context);
    const alreadyGranted = await context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "hasRole",
      args: [manager.address, roleId],
    });

    if (alreadyGranted) {
      output.write(`manager already has ${role.displayName}\n`);
      continue;
    }

    const hash = await walletClient.writeContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "grantRole",
      args: [roleId, manager.address],
    });
    await context.publicClient.waitForTransactionReceipt({ hash });

    txs.push({ label: `grant ${role.displayName}`, hash });
    output.write(`granted ${role.displayName} to manager\n`);
  }

  asset.metadata = {
    ...(asset.metadata ?? {}),
    managerOperationalRoles: TIP20_MANAGER_OPERATIONAL_ROLE_NAMES.join(","),
    managerOperationalRolesGrantedTo: manager.address,
    managerOperationalRolesUpdatedAt: nowIso(),
  };
  manager.metadata = {
    ...(manager.metadata ?? {}),
    operationalRolesGrantedOn: asset.address,
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
        asset: asset.address,
        manager: manager.address,
        roles: TIP20_MANAGER_OPERATIONAL_ROLE_NAMES.join(","),
      },
    });
  }

  output.write(`manager operational roles ready on ${asset.name} ${asset.address}\n`);
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

async function registerRoute(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const manager = requireReusableManager(context);
  const asset = resolveAssetFromArgs(args, context, true);
  const settlementToken = resolveSettlementToken(readOption(args, "--settlement") ?? "pathUSD");
  const artifact = await loadManagerArtifact();
  const walletClient = createTempoWalletClient(active, context.network);
  const hash = await walletClient.writeContract({
    address: manager.address,
    abi: artifact.abi,
    functionName: "registerRoute",
    args: [asset.address, settlementToken, true],
  });

  await context.publicClient.waitForTransactionReceipt({ hash });

  manager.metadata = {
    ...(manager.metadata ?? {}),
    [`route.${asset.name}.asset`]: asset.address,
    [`route.${asset.name}.settlementToken`]: settlementToken,
    [`route.${asset.name}.enabled`]: "true",
    [`route.${asset.name}.tx`]: hash,
    [`route.${asset.name}.updatedAt`]: nowIso(),
  };
  asset.metadata = {
    ...(asset.metadata ?? {}),
    lifecycleManager: manager.address,
    lifecycleRoute: "enabled",
    lifecycleSettlementToken: settlementToken,
  };
  context.deployments.updatedAt = nowIso();
  await context.saveDeployments(context.deployments);
  await recordHistory(context, {
    action: "manager register-route",
    summary: `registered ${asset.name} lifecycle route`,
    txs: [{ label: "registerRoute", hash }],
    metadata: {
      manager: manager.address,
      asset: asset.address,
      settlementToken,
    },
  });

  output.write(`registered route for ${asset.name}\n`);
  output.write(`asset: ${asset.address}\n`);
  output.write(`settlement: ${settlementToken}\n`);
  output.write(`manager: ${manager.address}\n`);
  output.write(`tx: ${hash}\n`);
}

function writeRoutes(context: ReplContext, output: Output): void {
  const manager = context.deployments.deployments.manager;

  if (!manager) {
    output.write("No manager deployed.\n");
    return;
  }

  if (!isReusableManager(manager)) {
    output.write(`route USDV legacy manager=${manager.address} asset=${manager.metadata?.usdv ?? "unknown"}\n`);
    return;
  }

  const routes = Object.values(context.deployments.deployments)
    .filter((deployment) => deployment.kind === "tip20")
    .filter((token) => manager.metadata?.[`route.${token.name}.enabled`] === "true");

  if (routes.length === 0) {
    output.write("No routes registered.\n");
    output.write("Use: manager register-route <symbol>\n");
    return;
  }

  for (const token of routes) {
    output.write(`route ${token.name} manager=${manager.address} asset=${token.address} settlement=${manager.metadata?.[`route.${token.name}.settlementToken`] ?? "unknown"}\n`);
  }
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
  const asset = resolveAssetFromArgs(args, context);
  assertRouteSupported(manager, asset);
  const amount = parseRequiredAmount(args[0], "manager subscribe <amount>");
  const minOut = parseTip20Amount(readOption(args, "--min") ?? args[0] ?? "0");
  const trace = resolveTracePreference(args, context);
  const walletClient = createTempoWalletClient(active, context.network);
  const artifact = await loadArtifactForManager(manager);
  const settlementToken = settlementTokenForRoute(manager, asset);
  const [pathUsdBefore, assetBefore, totalSupplyBefore] = await Promise.all([
    context.publicClient.readContract({
      address: settlementToken,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);

  if (pathUsdBefore < amount) {
    throw new Error(`Insufficient pathUSD. Balance=${formatTip20Amount(pathUsdBefore)}, required=${formatTip20Amount(amount)}.`);
  }

  const approveHash = await walletClient.writeContract({
    address: settlementToken,
    abi: tip20Abi,
    functionName: "approve",
    args: [manager.address, amount],
  });
  await context.publicClient.waitForTransactionReceipt({ hash: approveHash });

  const subscribeHash = isReusableManager(manager)
    ? await walletClient.writeContract({
      address: manager.address,
      abi: artifact.abi,
      functionName: "subscribe",
      args: [asset.address, settlementToken, amount, minOut],
    })
    : await walletClient.writeContract({
      address: manager.address,
      abi: artifact.abi,
      functionName: "subscribe",
      args: [settlementToken, amount, minOut],
    });
  await context.publicClient.waitForTransactionReceipt({ hash: subscribeHash });
  const [pathUsdAfter, assetAfter, totalSupplyAfter] = await Promise.all([
    context.publicClient.readContract({
      address: settlementToken,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);
  const mintMatches = assetAfter === assetBefore + amount;
  const supplyMatches = totalSupplyAfter === totalSupplyBefore + amount;

  await recordHistory(context, {
    action: "subscribe",
    summary: `subscribed ${formatTip20Amount(amount)} pathUSD for ${asset.name}`,
    txs: [
      { label: "approve settlement", hash: approveHash },
      { label: "subscribe", hash: subscribeHash },
    ],
    metadata: {
      manager: manager.address,
      asset: asset.address,
      amount: formatTip20Amount(amount),
    },
  });

  output.write(`subscribed ${formatTip20Amount(amount)} pathUSD for ${asset.name}\n`);
  output.write(`${active.name} ${asset.name}: ${formatTip20Amount(assetAfter)}\n`);
  output.write(`${active.name} pathUSD: ${formatTip20Amount(pathUsdAfter)}\n`);
  output.write(`${asset.name} total supply: ${formatTip20Amount(totalSupplyAfter)}\n`);

  if (!mintMatches || !supplyMatches) {
    output.write("warning: post-subscribe accounting did not match a clean mint; inspect the subscribe transaction before continuing.\n");
  }

  if (trace.enabled) {
    writeSubscribeTrace(output, {
      active,
      manager,
      asset,
      amount,
      minOut,
      pathUsdBefore,
      pathUsdAfter,
      assetBefore,
      assetAfter,
      totalSupplyBefore,
      totalSupplyAfter,
      settlementToken,
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
  const asset = resolveAssetFromArgs(args, context);
  assertRouteSupported(manager, asset);
  const amount = parseRequiredAmount(args[0], "manager redeem <amount>");
  const minOut = parseTip20Amount(readOption(args, "--min") ?? args[0] ?? "0");
  const trace = resolveTracePreference(args, context);
  const walletClient = createTempoWalletClient(active, context.network);
  const artifact = await loadArtifactForManager(manager);
  const settlementToken = settlementTokenForRoute(manager, asset);
  const [userAssetBefore, userPathUsdBefore, totalSupplyBefore] = await Promise.all([
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: settlementToken,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);

  if (userAssetBefore < amount) {
    throw new Error(`Insufficient ${asset.name}. Balance=${formatTip20Amount(userAssetBefore)}, required=${formatTip20Amount(amount)}.`);
  }

  const approveHash = await walletClient.writeContract({
    address: asset.address,
    abi: tip20Abi,
    functionName: "approve",
    args: [manager.address, amount],
  });
  await context.publicClient.waitForTransactionReceipt({ hash: approveHash });

  const redeemHash = isReusableManager(manager)
    ? await walletClient.writeContract({
      address: manager.address,
      abi: artifact.abi,
      functionName: "redeem",
      args: [asset.address, amount, settlementToken, minOut],
    })
    : await walletClient.writeContract({
      address: manager.address,
      abi: artifact.abi,
      functionName: "redeem",
      args: [amount, settlementToken, minOut],
    });
  await context.publicClient.waitForTransactionReceipt({ hash: redeemHash });
  const [userAssetAfter, userPathUsdAfter, managerAssetAfter, totalSupplyAfter] = await Promise.all([
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: settlementToken,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [active.address],
    }),
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [manager.address],
    }),
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);
  const userBurnMatches = userAssetAfter === userAssetBefore - amount;
  const supplyBurnMatches = totalSupplyAfter + amount === totalSupplyBefore;
  const managerCleared = managerAssetAfter === 0n;

  await recordHistory(context, {
    action: "redeem",
    summary: `redeemed ${formatTip20Amount(amount)} ${asset.name} for pathUSD`,
    txs: [
      { label: `approve ${asset.name}`, hash: approveHash },
      { label: "redeem", hash: redeemHash },
    ],
    metadata: {
      manager: manager.address,
      asset: asset.address,
      amount: formatTip20Amount(amount),
    },
  });

  output.write(`redeemed ${formatTip20Amount(amount)} ${asset.name} for pathUSD\n`);
  output.write(`${active.name} ${asset.name}: ${formatTip20Amount(userAssetAfter)}\n`);
  output.write(`${active.name} pathUSD: ${formatTip20Amount(userPathUsdAfter)}\n`);
  output.write(`manager ${asset.name}: ${formatTip20Amount(managerAssetAfter)}\n`);
  output.write(`${asset.name} total supply: ${formatTip20Amount(totalSupplyAfter)}\n`);

  if (!userBurnMatches || !supplyBurnMatches || !managerCleared) {
    output.write("warning: post-redeem accounting did not match a clean burn; inspect the redeem transaction before continuing.\n");
  }

  if (trace.enabled) {
    writeRedeemTrace(output, {
      active,
      manager,
      asset,
      amount,
      minOut,
      userAssetBefore,
      userAssetAfter,
      userPathUsdBefore,
      userPathUsdAfter,
      managerAssetAfter,
      totalSupplyBefore,
      totalSupplyAfter,
      settlementToken,
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
  const asset = resolveAssetFromArgs(args, context);
  assertRouteSupported(manager, asset);
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
  const artifact = await loadArtifactForManager(manager);
  const [recipientAssetBefore, totalSupplyBefore] = await Promise.all([
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [recipient.address],
    }),
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);
  const hash = isReusableManager(manager)
    ? await walletClient.writeContract({
      address: manager.address,
      abi: artifact.abi,
      functionName: "adminSubscribe",
      args: [asset.address, recipient.address, amount, minOut, memo],
    })
    : await walletClient.writeContract({
      address: manager.address,
      abi: artifact.abi,
      functionName: "adminSubscribe",
      args: [recipient.address, amount, minOut, memo],
    });
  await context.publicClient.waitForTransactionReceipt({ hash });
  const [recipientAssetAfter, totalSupplyAfter] = await Promise.all([
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "balanceOf",
      args: [recipient.address],
    }),
    context.publicClient.readContract({
      address: asset.address,
      abi: tip20Abi,
      functionName: "totalSupply",
    }),
  ]);
  const mintMatches = recipientAssetAfter === recipientAssetBefore + amount;
  const supplyMatches = totalSupplyAfter === totalSupplyBefore + amount;

  await recordHistory(context, {
    action: "admin-subscribe",
    summary: `admin subscribed ${recipient.label} for ${formatTip20Amount(amount)} ${asset.name}`,
    txs: [{ label: "adminSubscribe", hash }],
    metadata: {
      manager: manager.address,
      asset: asset.address,
      recipient: recipient.address,
      amount: formatTip20Amount(amount),
      memo,
    },
  });

  output.write(`admin subscribed ${recipient.label} for ${formatTip20Amount(amount)} ${asset.name}\n`);
  output.write(`${recipient.label} ${asset.name}: ${formatTip20Amount(recipientAssetAfter)}\n`);
  output.write(`${asset.name} total supply: ${formatTip20Amount(totalSupplyAfter)}\n`);

  if (!mintMatches || !supplyMatches) {
    output.write("warning: post-admin-subscribe accounting did not match a clean mint; inspect the transaction before continuing.\n");
  }

  if (trace.enabled) {
    writeAdminSubscribeTrace(output, {
      active,
      manager,
      asset,
      recipientLabel: recipient.label,
      recipientAddress: recipient.address,
      amount,
      minOut,
      memo,
      recipientAssetBefore,
      recipientAssetAfter,
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
    asset: DeploymentRecord;
    amount: bigint;
    minOut: bigint;
    settlementToken: Address;
    pathUsdBefore: bigint;
    pathUsdAfter: bigint;
    assetBefore: bigint;
    assetAfter: bigint;
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
  output.write(`     token: ${params.settlementToken}\n`);
  output.write(`     spender: ${params.manager.address}\n`);
  output.write(`     tx: ${params.approveHash}\n`);
  output.write(`  4. call: manager.subscribe(${params.asset.name}, pathUSD, ${formatTip20Amount(params.amount)}, min ${formatTip20Amount(params.minOut)})\n`);
  output.write(`     manager: ${params.manager.address}\n`);
  output.write(`     tx: ${params.subscribeHash}\n`);
  output.write("  5. manager flow:\n");
  output.write(`     - pulls ${formatTip20Amount(params.amount)} pathUSD from ${params.active.name} with transferFrom\n`);
  output.write(`     - external TIP-20 call: ${params.asset.name}.mintWithMemo(${params.active.name}, ${formatTip20Amount(params.amount)}, memo)\n`);
  output.write(`     - permission: ${describeIssuerRole(params.manager, params.asset)}\n`);
  output.write("  6. result:\n");
  output.write(`     - ${params.active.name} pathUSD: ${formatTip20Amount(params.pathUsdBefore)} -> ${formatTip20Amount(params.pathUsdAfter)} (includes Tempo fees)\n`);
  output.write(`     - ${params.active.name} ${params.asset.name}: ${formatTip20Amount(params.assetBefore)} -> ${formatTip20Amount(params.assetAfter)}\n`);
  output.write(`     - ${params.asset.name} total supply: ${formatTip20Amount(params.totalSupplyBefore)} -> ${formatTip20Amount(params.totalSupplyAfter)}\n`);
}

function writeRedeemTrace(
  output: Output,
  params: {
    active: AccountProfile;
    manager: DeploymentRecord;
    asset: DeploymentRecord;
    amount: bigint;
    minOut: bigint;
    settlementToken: Address;
    userAssetBefore: bigint;
    userAssetAfter: bigint;
    userPathUsdBefore: bigint;
    userPathUsdAfter: bigint;
    managerAssetAfter: bigint;
    totalSupplyBefore: bigint;
    totalSupplyAfter: bigint;
    approveHash: Hash;
    redeemHash: Hash;
  },
): void {
  output.write("trace:\n");
  output.write(`  1. CLI route: redeem ${formatTip20Amount(params.amount)} -> manager redeem ${formatTip20Amount(params.amount)}\n`);
  output.write(`  2. signer: ${params.active.name} ${params.active.address}\n`);
  output.write(`  3. approve: ${params.asset.name}.approve(manager, ${formatTip20Amount(params.amount)})\n`);
  output.write(`     token: ${params.asset.address}\n`);
  output.write(`     spender: ${params.manager.address}\n`);
  output.write(`     tx: ${params.approveHash}\n`);
  output.write(`  4. call: manager.redeem(${params.asset.name}, ${formatTip20Amount(params.amount)}, pathUSD, min ${formatTip20Amount(params.minOut)})\n`);
  output.write(`     manager: ${params.manager.address}\n`);
  output.write(`     tx: ${params.redeemHash}\n`);
  output.write("  5. manager flow:\n");
  output.write(`     - pulls ${formatTip20Amount(params.amount)} ${params.asset.name} from ${params.active.name} with transferFrom\n`);
  output.write(`     - external TIP-20 call: ${params.asset.name}.burnWithMemo(${formatTip20Amount(params.amount)}, memo)\n`);
  output.write(`     - permission: ${describeIssuerRole(params.manager, params.asset)}\n`);
  output.write(`     - sends ${formatTip20Amount(params.amount)} pathUSD back to ${params.active.name}\n`);
  output.write("  6. result:\n");
  output.write(`     - ${params.active.name} ${params.asset.name}: ${formatTip20Amount(params.userAssetBefore)} -> ${formatTip20Amount(params.userAssetAfter)}\n`);
  output.write(`     - ${params.active.name} pathUSD: ${formatTip20Amount(params.userPathUsdBefore)} -> ${formatTip20Amount(params.userPathUsdAfter)} (includes Tempo fees)\n`);
  output.write(`     - manager ${params.asset.name}: ${formatTip20Amount(params.managerAssetAfter)}\n`);
  output.write(`     - ${params.asset.name} total supply: ${formatTip20Amount(params.totalSupplyBefore)} -> ${formatTip20Amount(params.totalSupplyAfter)}\n`);
}

function writeAdminSubscribeTrace(
  output: Output,
  params: {
    active: AccountProfile;
    manager: DeploymentRecord;
    asset: DeploymentRecord;
    recipientLabel: string;
    recipientAddress: Address;
    amount: bigint;
    minOut: bigint;
    memo: Hex;
    recipientAssetBefore: bigint;
    recipientAssetAfter: bigint;
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
  output.write(`     - external TIP-20 call: ${params.asset.name}.mintWithMemo(${params.recipientLabel}, ${formatTip20Amount(params.amount)}, memo)\n`);
  output.write(`     - permission: ${describeIssuerRole(params.manager, params.asset)}\n`);
  output.write("  5. result:\n");
  output.write(`     - ${params.recipientLabel} ${params.asset.name}: ${formatTip20Amount(params.recipientAssetBefore)} -> ${formatTip20Amount(params.recipientAssetAfter)}\n`);
  output.write(`     - ${params.asset.name} total supply: ${formatTip20Amount(params.totalSupplyBefore)} -> ${formatTip20Amount(params.totalSupplyAfter)}\n`);
}

function describeIssuerRole(manager: DeploymentRecord, asset: DeploymentRecord): string {
  if (manager.metadata?.operationalRolesGrantedOn?.toLowerCase() === asset.address.toLowerCase()) {
    return `manager has operational TIP-20 roles (${manager.metadata.operationalRoles})`;
  }

  if (manager.metadata?.issuerRoleTx && manager.metadata.issuerRoleGrantedOn?.toLowerCase() === asset.address.toLowerCase()) {
    return `manager has ${asset.name} ISSUER_ROLE (grant tx ${manager.metadata.issuerRoleTx})`;
  }

  return `manager must have ${asset.name} ISSUER_ROLE; no grant tx is recorded in local state`;
}

function isReusableManager(manager: DeploymentRecord): boolean {
  return manager.metadata?.managerVersion === "multi-asset";
}

function requireReusableManager(context: ReplContext): DeploymentRecord {
  const manager = requireDeployment("manager", context);

  if (!isReusableManager(manager)) {
    throw new Error([
      "Current manager is the legacy USDV-only contract.",
      "Run: manager deploy --replace",
      "Then register a route with: manager register-route <symbol>",
    ].join("\n"));
  }

  return manager;
}

async function loadArtifactForManager(manager: DeploymentRecord) {
  return isReusableManager(manager) ? loadManagerArtifact() : loadLegacyManagerArtifact();
}

function resolveAssetFromArgs(args: string[], context: ReplContext, allowPositional = false): DeploymentRecord {
  const assetArg = readOption(args, "--asset") ?? (allowPositional ? firstPositionalArg(args) : undefined) ?? "USDV";
  const token = context.deployments.deployments[tokenStateKey(assetArg)];

  if (!token || token.kind !== "tip20") {
    throw new Error([
      `Unknown TIP-20 token: ${assetArg}`,
      "Run: token list",
      "Create one with: token create <symbol>",
    ].join("\n"));
  }

  return token;
}

function firstPositionalArg(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg.startsWith("--")) {
      index += 1;
      continue;
    }

    return arg;
  }

  return undefined;
}

function assertRouteSupported(manager: DeploymentRecord, asset: DeploymentRecord): void {
  if (!isReusableManager(manager)) {
    if (manager.metadata?.usdv?.toLowerCase() === asset.address.toLowerCase()) {
      return;
    }

    throw new Error([
      `No lifecycle route for ${asset.name}.`,
      "Current manager is the legacy USDV-only contract.",
      "Run: manager deploy --replace",
      `Then: manager register-route ${asset.name}`,
    ].join("\n"));
  }

  if (manager.metadata?.[`route.${asset.name}.enabled`] !== "true") {
    throw new Error([
      `No lifecycle route for ${asset.name}.`,
      `Run: manager register-route ${asset.name}`,
      `Then grant roles with: manager grant-operational-roles --asset ${asset.name}`,
      "Finally allow the operator in policy.",
    ].join("\n"));
  }
}

function settlementTokenForRoute(manager: DeploymentRecord, asset: DeploymentRecord): Address {
  const routeSettlement = manager.metadata?.[`route.${asset.name}.settlementToken`] as Address | undefined;
  const defaultSettlement = manager.metadata?.settlementToken as Address | undefined;

  return routeSettlement ?? defaultSettlement ?? TESTNET_TIP20_TOKENS.pathUSD;
}

function resolveSettlementToken(value: string): Address {
  const known = TESTNET_TIP20_TOKENS[value as keyof typeof TESTNET_TIP20_TOKENS];

  if (known) {
    return known;
  }

  if (!isAddress(value)) {
    throw new Error(`Unknown settlement token: ${value}. Use pathUSD or a valid 0x token address.`);
  }

  return getAddress(value) as Address;
}

function tokenStateKey(symbol: string): string {
  return symbol.trim().toLowerCase();
}

function managerAssetSymbol(manager: DeploymentRecord, context: ReplContext): string {
  const asset = Object.values(context.deployments.deployments).find((deployment) => (
    deployment.kind === "tip20"
    && manager.metadata?.usdv?.toLowerCase() === deployment.address.toLowerCase()
  ));

  return asset?.name ?? "manager";
}

function uniqueDeploymentKey(base: string, context: ReplContext): string {
  let key = base;
  let index = 2;

  while (context.deployments.deployments[key]) {
    key = `${base}-${index}`;
    index += 1;
  }

  return key;
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
