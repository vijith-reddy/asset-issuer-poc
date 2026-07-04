import { parseEventLogs, type Hash, type Log } from "viem";
import { resolveAddress } from "../utils/address-book.js";
import {
  createTempoWalletClient,
  fromTip403PolicyType,
  TIP403_REGISTRY_ADDRESS,
  tip403RegistryAbi,
  toTip403PolicyType,
} from "../tempo/index.js";
import {
  nowIso,
  type Address,
  type PoliciesState,
  type PolicyRecord,
  type PolicyType,
} from "../state/index.js";
import type { ReplContext } from "../repl/context.js";
import { recordHistory } from "./history.js";

type Output = Pick<NodeJS.WritableStream, "write">;

export async function handlePolicyCommand(args: string[], context: ReplContext, output: Output): Promise<void> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === "help") {
    writePolicyHelp(output);
    return;
  }

  if (subcommand === "list") {
    writePolicyList(context, output);
    return;
  }

  if (subcommand === "use") {
    await usePolicy(rest[0], context, output);
    return;
  }

  if (subcommand === "create") {
    await createPolicy(rest, context, output);
    return;
  }

  if (subcommand === "inspect") {
    await inspectPolicy(rest[0], context, output);
    return;
  }

  if (subcommand === "check") {
    await checkPolicy(rest, context, output);
    return;
  }

  if (subcommand === "allow" || subcommand === "remove" || subcommand === "block" || subcommand === "unblock") {
    await modifyPolicyMember(subcommand, rest, context, output);
    return;
  }

  if (subcommand === "set-admin") {
    await setPolicyAdmin(rest, context, output);
    return;
  }

  output.write(`Unknown policy command: ${subcommand}\n`);
  writePolicyHelp(output);
}

function writePolicyHelp(output: Output): void {
  output.write(`Policy commands:
  policy create <name> <whitelist|blacklist> [--admin <profile|address>]
  policy list
  policy use <name>
  policy inspect [name]
  policy check <profile|address> [name]
  policy allow <profile|address> [name]
  policy remove <profile|address> [name]
  policy block <profile|address> [name]
  policy unblock <profile|address> [name]
  policy set-admin <profile|address> [name]
`);
}

function writePolicyList(context: ReplContext, output: Output): void {
  const records = Object.values(context.policies.policies).sort((left, right) => left.name.localeCompare(right.name));

  if (records.length === 0) {
    output.write("No local policies found.\n");
    return;
  }

  for (const policy of records) {
    const activeMarker = policy.name === context.session.activePolicy ? "*" : " ";
    output.write(`${activeMarker} ${policy.name} id=${policy.id} type=${policy.type} admin=${policy.admin}\n`);
  }

  if (!context.session.activePolicy) {
    const onlyPolicy = records[0];

    if (onlyPolicy && records.length === 1) {
      output.write(`No active policy selected for this session. Use: policy use ${onlyPolicy.name}\n`);
    } else {
      output.write("No active policy selected for this session. Use: policy use <name>\n");
    }
  }
}

async function usePolicy(name: string | undefined, context: ReplContext, output: Output): Promise<void> {
  const policy = requirePolicyByName(name ?? "", context);

  context.session.activePolicy = policy.name;
  await context.saveSession(context.session);

  output.write(`active policy: ${policy.name} id=${policy.id} type=${policy.type}\n`);
}

async function createPolicy(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const [name, rawType] = args;

  if (!name || !rawType) {
    output.write("Usage: policy create <name> <whitelist|blacklist> [--admin <profile|address>]\n");
    return;
  }

  const type = parsePolicyType(rawType);
  const adminArg = readOption(args, "--admin");
  const admin = adminArg ? resolveAddress(adminArg, context.accounts) : {
    label: active.name,
    address: active.address,
    isKnownProfile: true,
  };

  if (context.policies.policies[name]) {
    throw new Error(`Policy already exists locally: ${name}`);
  }

  const walletClient = createTempoWalletClient(active, context.network);
  const hash = await walletClient.writeContract({
    address: TIP403_REGISTRY_ADDRESS,
    abi: tip403RegistryAbi,
    functionName: "createPolicy",
    args: [admin.address, toTip403PolicyType(type)],
  });

  const receipt = await context.publicClient.waitForTransactionReceipt({ hash });
  const policyId = readCreatedPolicyId(receipt.logs);
  const createdAt = nowIso();

  const record: PolicyRecord = {
    name,
    id: policyId.toString(),
    type,
    admin: admin.label,
    network: context.network.key,
    members: {},
    createdAt,
    txHash: hash,
  };

  context.policies.policies[name] = record;
  context.policies.updatedAt = createdAt;
  context.session.activePolicy = name;

  await context.savePolicies(context.policies);
  await context.saveSession(context.session);
  await recordHistory(context, {
    action: "policy create",
    summary: `created ${type} policy ${name}`,
    txs: [{ label: "createPolicy", hash }],
    metadata: {
      policy: name,
      policyId: record.id,
      type,
      admin: admin.address,
    },
  });

  output.write(`created policy ${name} id=${record.id} type=${type} admin=${admin.label}\n`);
  output.write(`tx: ${hash}\n`);
}

async function inspectPolicy(name: string | undefined, context: ReplContext, output: Output): Promise<void> {
  const policy = resolvePolicy(name, context);
  const [policyType, admin] = await context.publicClient.readContract({
    address: TIP403_REGISTRY_ADDRESS,
    abi: tip403RegistryAbi,
    functionName: "policyData",
    args: [BigInt(policy.id)],
  });

  output.write(`name: ${policy.name}\n`);
  output.write(`id: ${policy.id}\n`);
  output.write(`local type: ${policy.type}\n`);
  output.write(`chain type: ${fromTip403PolicyType(policyType)}\n`);
  output.write(`local admin: ${policy.admin}\n`);
  output.write(`chain admin: ${admin}\n`);
  output.write(`known members: ${Object.keys(policy.members).length}\n`);

  for (const member of Object.values(policy.members).sort((left, right) => left.name.localeCompare(right.name))) {
    output.write(`  ${member.name} ${member.address} included=${member.included}\n`);
  }
}

async function checkPolicy(args: string[], context: ReplContext, output: Output): Promise<void> {
  const [targetArg, policyName] = args;

  if (!targetArg) {
    output.write("Usage: policy check <profile|address> [name]\n");
    return;
  }

  const target = resolveAddress(targetArg, context.accounts);
  const policy = resolvePolicy(policyName, context);
  const allowed = await context.publicClient.readContract({
    address: TIP403_REGISTRY_ADDRESS,
    abi: tip403RegistryAbi,
    functionName: "isAuthorized",
    args: [BigInt(policy.id), target.address],
  });

  output.write(`${target.label} is ${allowed ? "authorized" : "not authorized"} by ${policy.name}\n`);
}

async function modifyPolicyMember(
  action: "allow" | "remove" | "block" | "unblock",
  args: string[],
  context: ReplContext,
  output: Output,
): Promise<void> {
  const active = requireActiveProfile(context);
  const [targetArg, policyName] = args;

  if (!targetArg) {
    output.write(`Usage: policy ${action} <profile|address> [name]\n`);
    return;
  }

  const policy = resolvePolicy(policyName, context);
  const target = resolveAddress(targetArg, context.accounts);
  const shouldBeIncluded = action === "allow" || action === "block";
  const walletClient = createTempoWalletClient(active, context.network);

  validatePolicyAction(policy.type, action);

  const hash = policy.type === "whitelist"
    ? await walletClient.writeContract({
      address: TIP403_REGISTRY_ADDRESS,
      abi: tip403RegistryAbi,
      functionName: "modifyPolicyWhitelist",
      args: [BigInt(policy.id), target.address, shouldBeIncluded],
    })
    : await walletClient.writeContract({
      address: TIP403_REGISTRY_ADDRESS,
      abi: tip403RegistryAbi,
      functionName: "modifyPolicyBlacklist",
      args: [BigInt(policy.id), target.address, shouldBeIncluded],
    });

  await context.publicClient.waitForTransactionReceipt({ hash });

  // TIP-403 does not enumerate members, so the CLI keeps a local mirror for operator visibility.
  policy.members[target.label] = {
    name: target.label,
    address: target.address,
    included: shouldBeIncluded,
    updatedAt: nowIso(),
  };
  context.policies.updatedAt = nowIso();
  await context.savePolicies(context.policies);
  await recordHistory(context, {
    action: `policy ${action}`,
    summary: `${policy.name}: ${target.label} included=${shouldBeIncluded}`,
    txs: [{ label: policy.type === "whitelist" ? "modifyPolicyWhitelist" : "modifyPolicyBlacklist", hash }],
    metadata: {
      policy: policy.name,
      policyId: policy.id,
      target: target.address,
      included: String(shouldBeIncluded),
    },
  });

  output.write(`${policy.name}: ${target.label} included=${shouldBeIncluded}\n`);
  output.write(`tx: ${hash}\n`);
}

async function setPolicyAdmin(args: string[], context: ReplContext, output: Output): Promise<void> {
  const active = requireActiveProfile(context);
  const [adminArg, policyName] = args;

  if (!adminArg) {
    output.write("Usage: policy set-admin <profile|address> [name]\n");
    return;
  }

  const policy = resolvePolicy(policyName, context);
  const admin = resolveAddress(adminArg, context.accounts);
  const walletClient = createTempoWalletClient(active, context.network);
  const hash = await walletClient.writeContract({
    address: TIP403_REGISTRY_ADDRESS,
    abi: tip403RegistryAbi,
    functionName: "setPolicyAdmin",
    args: [BigInt(policy.id), admin.address],
  });

  await context.publicClient.waitForTransactionReceipt({ hash });

  policy.admin = admin.label;
  context.policies.updatedAt = nowIso();
  await context.savePolicies(context.policies);
  await recordHistory(context, {
    action: "policy set-admin",
    summary: `${policy.name}: admin=${admin.label}`,
    txs: [{ label: "setPolicyAdmin", hash }],
    metadata: {
      policy: policy.name,
      policyId: policy.id,
      admin: admin.address,
    },
  });

  output.write(`${policy.name}: admin=${admin.label}\n`);
  output.write(`tx: ${hash}\n`);
}

function requireActiveProfile(context: ReplContext) {
  if (!context.activeProfile) {
    throw new Error("No active profile. Use: use admin");
  }

  return context.activeProfile;
}

function resolvePolicy(name: string | undefined, context: ReplContext): PolicyRecord {
  return requirePolicyByName(name ?? context.session.activePolicy ?? "", context);
}

function requirePolicyByName(name: string, context: ReplContext): PolicyRecord {
  const policy = context.policies.policies[name];

  if (!policy) {
    throw new Error(name ? `Unknown policy: ${name}` : "No active policy. Use: policy use <name>");
  }

  return policy;
}

function parsePolicyType(value: string): PolicyType {
  if (value === "whitelist" || value === "blacklist") {
    return value;
  }

  throw new Error(`Invalid policy type "${value}". Use whitelist or blacklist.`);
}

function readOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function readCreatedPolicyId(logs: readonly Log[]): bigint {
  const events = parseEventLogs({
    abi: tip403RegistryAbi,
    eventName: "PolicyCreated",
    logs: [...logs],
  });
  const event = events[0];

  if (!event) {
    throw new Error("PolicyCreated event was not found in transaction receipt.");
  }

  return event.args.policyId;
}

function validatePolicyAction(type: PolicyType, action: string): void {
  if (type === "whitelist" && (action === "block" || action === "unblock")) {
    throw new Error("This is a whitelist policy. Use remove to block a member, or allow to restore them.");
  }

  if (type === "blacklist" && (action === "allow" || action === "remove")) {
    throw new Error("This is a blacklist policy. Use block to add a member, or unblock to restore them.");
  }
}
