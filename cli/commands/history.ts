import { nowIso, type Hash, type HistoryEntry, type HistoryStatus } from "../state/index.js";
import type { ReplContext } from "../repl/context.js";

type Output = Pick<NodeJS.WritableStream, "write">;

const HISTORY_LIMIT = 100;

export interface HistoryTxInput {
  label: string;
  hash: Hash;
}

export interface RecordHistoryInput {
  action: string;
  status?: HistoryStatus;
  summary: string;
  txs?: HistoryTxInput[];
  error?: string;
  metadata?: Record<string, string>;
}

export async function recordHistory(context: ReplContext, input: RecordHistoryInput): Promise<void> {
  const createdAt = nowIso();
  const entry: HistoryEntry = {
    id: `${Date.now().toString(36)}-${(context.history.entries.length + 1).toString(36)}`,
    createdAt,
    sessionId: context.session.sessionId,
    network: context.network.key,
    action: input.action,
    status: input.status ?? "success",
    summary: input.summary,
    txs: input.txs ?? [],
  };

  if (context.activeProfile) {
    entry.profile = context.activeProfile.name;
  }

  if (input.error) {
    entry.error = input.error;
  }

  if (input.metadata) {
    entry.metadata = input.metadata;
  }

  context.history.entries.push(entry);
  context.history.entries = context.history.entries.slice(-HISTORY_LIMIT);
  context.history.updatedAt = createdAt;
  await context.saveHistory(context.history);
}

export function handleHistoryCommand(args: string[], context: ReplContext, output: Output): void {
  const [rawLimit] = args;

  if (rawLimit === "help") {
    writeHistoryHelp(output);
    return;
  }

  const limit = parseLimit(rawLimit);
  const entries = context.history.entries.slice(-limit).reverse();

  if (entries.length === 0) {
    output.write("No history for this session yet.\n");
    return;
  }

  for (const [index, entry] of entries.entries()) {
    output.write(`${index + 1}. ${entry.createdAt} ${entry.status} ${entry.action} - ${entry.summary}\n`);

    for (const tx of entry.txs) {
      output.write(`   ${tx.label}: ${tx.hash}\n`);
    }

    if (entry.error) {
      output.write(`   error: ${entry.error}\n`);
    }
  }
}

export function handleReceiptCommand(args: string[], context: ReplContext, output: Output): void {
  const [selector = "last"] = args;

  if (selector === "help") {
    output.write("Usage: receipt [last|history-number|entry-id]\n");
    return;
  }

  const entry = findEntry(selector, context.history.entries);

  if (!entry) {
    output.write(`No history entry found for: ${selector}\n`);
    return;
  }

  output.write(`id: ${entry.id}\n`);
  output.write(`created: ${entry.createdAt}\n`);
  output.write(`session: ${entry.sessionId}\n`);
  output.write(`network: ${entry.network}\n`);
  output.write(`profile: ${entry.profile ?? "none"}\n`);
  output.write(`status: ${entry.status}\n`);
  output.write(`action: ${entry.action}\n`);
  output.write(`summary: ${entry.summary}\n`);

  for (const tx of entry.txs) {
    output.write(`${tx.label}: ${tx.hash}\n`);
  }

  if (entry.error) {
    output.write(`error: ${entry.error}\n`);
  }

  if (entry.metadata) {
    for (const [key, value] of Object.entries(entry.metadata)) {
      output.write(`${key}: ${value}\n`);
    }
  }
}

function writeHistoryHelp(output: Output): void {
  output.write(`History commands:
  history [limit]       Show recent entries for this terminal session
  receipt [last|n|id]   Show one history entry in detail
`);
}

function parseLimit(value: string | undefined): number {
  if (!value) {
    return 10;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("History limit must be a positive number.");
  }

  return Math.min(parsed, HISTORY_LIMIT);
}

function findEntry(selector: string, entries: HistoryEntry[]): HistoryEntry | undefined {
  if (selector === "last") {
    return entries.at(-1);
  }

  const newestFirst = entries.toReversed();
  const index = Number.parseInt(selector, 10);

  if (Number.isFinite(index) && index >= 1) {
    return newestFirst[index - 1];
  }

  return entries.find((entry) => entry.id === selector);
}
