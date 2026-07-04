import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { Writable } from "node:stream";
import { listAccountProfiles, normalizeProfileName } from "../accounts/index.js";
import { handleDemoCommand } from "../commands/demo.js";
import { handleHistoryCommand, handleReceiptCommand } from "../commands/history.js";
import { handlePolicyCommand } from "../commands/policy.js";
import { handleManagerCommand } from "../commands/manager.js";
import { handleBalanceCommand, handleSendCommand } from "../commands/payments.js";
import { handleTokenCommand } from "../commands/token.js";
import type { ReplContext } from "./context.js";
import { nowIso } from "../state/index.js";
import { suggestTopLevelCommand } from "../utils/command-hints.js";
import { formatCliError } from "../utils/errors.js";
import { formatUnknownProfileMessage } from "../utils/profile-hints.js";
import { REPL_HELP } from "./help.js";
import { renderPrompt } from "./prompt.js";

export async function runRepl(context: ReplContext): Promise<void> {
  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  });

  stdout.write("USDV POC console. Type help for commands, exit to quit.\n");

  try {
    while (true) {
      const line = await rl.question(renderPrompt(context.activeProfile?.name));
      const shouldExit = await handleLineSafely(line, context, stdout);

      if (shouldExit) {
        break;
      }
    }
  } finally {
    rl.close();
  }
}

async function handleLineSafely(rawLine: string, context: ReplContext, output: Writable): Promise<boolean> {
  try {
    return await handleLine(rawLine, context, output);
  } catch (error) {
    output.write(`Error: ${formatCliError(error)}\n`);
    return false;
  }
}

async function handleLine(rawLine: string, context: ReplContext, output: Writable): Promise<boolean> {
  const line = rawLine.trim();

  if (!line) {
    return false;
  }

  if (line === "exit" || line === "quit") {
    output.write("bye\n");
    return true;
  }

  if (line === "help" || line === "?") {
    output.write(`${REPL_HELP}\n`);
    return false;
  }

  const parts = line.split(/\s+/);
  const command = parts[0]!;
  const args = parts.slice(1);

  if (command === "accounts") {
    writeAccounts(context, output);
    return false;
  }

  if (command === "session") {
    writeSession(context, output);
    return false;
  }

  if (command === "trace") {
    await configureTrace(args, context, output);
    return false;
  }

  if (command === "network") {
    writeNetwork(context, output);
    return false;
  }

  if (command === "whoami") {
    writeWhoami(context, output);
    return false;
  }

  if (command === "history") {
    handleHistoryCommand(args, context, output);
    return false;
  }

  if (command === "receipt") {
    handleReceiptCommand(args, context, output);
    return false;
  }

  if (command === "balance") {
    await handleBalanceCommand(args, context, output);
    return false;
  }

  if (command === "send") {
    await handleSendCommand(args, context, output);
    return false;
  }

  if (command === "demo") {
    await handleDemoCommand(args, context, output);
    return false;
  }

  if (command === "use") {
    if (args[0] === "policy") {
      await handlePolicyCommand(["use", ...args.slice(1)], context, output);
      return false;
    }

    await useProfile(args[0], context, output);
    return false;
  }

  if (command === "subscribe" || command === "redeem" || command === "admin-subscribe") {
    await handleManagerCommand([command, ...args], context, output);
    return false;
  }

  if (command === "policy") {
    await handlePolicyCommand(args, context, output);
    return false;
  }

  if (command === "token") {
    await handleTokenCommand(args, context, output);
    return false;
  }

  if (command === "manager") {
    await handleManagerCommand(args, context, output);
    return false;
  }

  // Unknown commands are not errors yet; future steps will route real commands here.
  output.write(`Unknown command: ${line}\n`);
  const suggestion = suggestTopLevelCommand(command);

  if (suggestion) {
    output.write(`Did you mean: ${suggestion}\n`);
  }

  output.write("Type help for available commands.\n");
  return false;
}

function writeAccounts(context: ReplContext, output: Writable): void {
  const profiles = listAccountProfiles(context.accounts);

  if (profiles.length === 0) {
    output.write("No local profiles found.\n");
    output.write("Create one with: make accounts-generate NAMES=\"alice\"\n");
    return;
  }

  for (const profile of profiles) {
    const activeMarker = profile.name === context.activeProfile?.name ? "*" : " ";
    output.write(`${activeMarker} ${profile.name} (${profile.kind}) ${profile.address}\n`);
  }
}

function writeSession(context: ReplContext, output: Writable): void {
  output.write(`session: ${context.session.sessionId}\n`);
  output.write(`network: ${context.session.network}\n`);
  output.write(`active profile: ${context.activeProfile?.name ?? "none"}\n`);
  output.write(`trace: ${isTraceEnabled(context) ? "on" : "off"}\n`);
}

function writeNetwork(context: ReplContext, output: Writable): void {
  output.write(`network: ${context.network.label}\n`);
  output.write(`key: ${context.network.key}\n`);
  output.write(`chain id: ${context.network.chainId}\n`);
  output.write(`rpc: ${context.network.rpcUrl}\n`);

  if (context.network.explorerUrl) {
    output.write(`explorer: ${context.network.explorerUrl}\n`);
  }

  if (context.network.feeToken) {
    output.write(`fee token: ${context.network.feeToken}\n`);
  }
}

function writeWhoami(context: ReplContext, output: Writable): void {
  if (!context.activeProfile) {
    output.write("No active profile. Use: use alice\n");
    return;
  }

  output.write(`name: ${context.activeProfile.name}\n`);
  output.write(`kind: ${context.activeProfile.kind}\n`);
  output.write(`address: ${context.activeProfile.address}\n`);
}

async function useProfile(profileName: string | undefined, context: ReplContext, output: Writable): Promise<void> {
  if (!profileName) {
    output.write("Usage: use <profile>\n");
    return;
  }

  const normalized = normalizeProfileName(profileName);
  const profile = context.accounts.accounts[normalized];

  if (!profile) {
    output.write(`${formatUnknownProfileMessage(profileName, {
      retryCommand: `use ${normalized}`,
    })}\n`);
    output.write("Run accounts to see available profiles.\n");
    return;
  }

  context.activeProfile = profile;
  context.session.activeProfile = profile.name;
  context.session.updatedAt = nowIso();

  // Persist only the chosen profile name. The private key remains in accounts.local.json.
  await context.saveSession(context.session);
  output.write(`using ${profile.name} (${profile.kind}) ${profile.address}\n`);
}

async function configureTrace(args: string[], context: ReplContext, output: Writable): Promise<void> {
  const mode = args[0];

  if (!mode) {
    output.write(`trace: ${isTraceEnabled(context) ? "on" : "off"}\n`);
    output.write("Usage: trace [on|off]\n");
    return;
  }

  if (mode !== "on" && mode !== "off") {
    output.write("Usage: trace [on|off]\n");
    return;
  }

  context.session.traceEnabled = mode === "on";
  await context.saveSession(context.session);
  output.write(`trace ${mode}\n`);
}

function isTraceEnabled(context: ReplContext): boolean {
  return context.session.traceEnabled ?? true;
}
