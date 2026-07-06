import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeProfileName } from "../../cli/accounts/index.js";
import { handleDemoCommand } from "../../cli/commands/demo.js";
import { handleHistoryCommand, handleReceiptCommand } from "../../cli/commands/history.js";
import { handleManagerCommand } from "../../cli/commands/manager.js";
import { handleBalanceCommand, handleSendCommand } from "../../cli/commands/payments.js";
import { handlePolicyCommand } from "../../cli/commands/policy.js";
import { handleTokenCommand } from "../../cli/commands/token.js";
import { getTempoNetworkConfig, loadPocEnv } from "../../cli/config/index.js";
import type { ReplContext } from "../../cli/repl/index.js";
import {
  ensureLocalStateLayout,
  getStatePaths,
  loadAccountsState,
  loadDeploymentsState,
  loadHistoryState,
  loadPoliciesState,
  loadSessionState,
  saveDeploymentsState,
  saveHistoryState,
  savePoliciesState,
  saveSessionState,
  type AccountProfile,
  type HistoryEntry,
  type HistoryState,
  type NetworkName,
} from "../../cli/state/index.js";
import { createTempoPublicClient } from "../../cli/tempo/index.js";
import { formatCliError } from "../../cli/utils/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const publicDir = join(__dirname, "public");
const port = Number(process.env.POC_WEB_PORT ?? 5177);
const network: NetworkName = "moderato";

type WebActor = "admin" | "manager" | "alice" | "bob";

interface ActionRequest {
  actor: WebActor;
  command: string;
  args?: string[];
}

interface OutputBuffer {
  text: string;
  write: (chunk: string | Uint8Array) => boolean;
}

const server = createServer(async (request, response) => {
  try {
    if (!request.url) {
      writeJson(response, 400, { ok: false, error: "Missing URL" });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/state") {
      writeJson(response, 200, { ok: true, state: await readWebState() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/action") {
      const body = await readJsonBody<ActionRequest>(request);
      const result = await runAction(body);
      writeJson(response, 200, { ok: true, ...result, state: await readWebState() });
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(url.pathname, request.method === "HEAD", response);
      return;
    }

    writeJson(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    writeJson(response, 500, { ok: false, error: formatCliError(error) });
  }
});

server.listen(port, () => {
  console.log(`USDV POC web UI listening on http://localhost:${port}`);
});

async function runAction(body: ActionRequest): Promise<{ output: string }> {
  const args = body.args ?? [];
  const context = await loadWebContext(body.actor);
  const output = createOutputBuffer();

  if (body.command === "token") {
    await handleTokenCommand(args, context, output);
  } else if (body.command === "policy") {
    await handlePolicyCommand(args, context, output);
  } else if (body.command === "manager") {
    await handleManagerCommand(args, context, output);
  } else if (body.command === "balance") {
    await handleBalanceCommand(args, context, output);
  } else if (body.command === "send") {
    await handleSendCommand(args, context, output);
  } else if (body.command === "subscribe" || body.command === "redeem" || body.command === "admin-subscribe") {
    await handleManagerCommand([body.command, ...args], context, output);
  } else if (body.command === "demo") {
    await handleDemoCommand(args, context, output);
  } else if (body.command === "history") {
    handleHistoryCommand(args, context, output);
  } else if (body.command === "receipt") {
    handleReceiptCommand(args, context, output);
  } else {
    throw new Error(`Unknown web action: ${body.command}`);
  }

  return { output: output.text.trimEnd() };
}

async function loadWebContext(actor: WebActor): Promise<ReplContext> {
  await ensureLocalStateLayout();

  const env = loadPocEnv(repoRoot);
  const networkConfig = getTempoNetworkConfig(network, env);
  const accounts = await loadAccountsState();
  const deployments = await loadDeploymentsState();
  const policies = await loadPoliciesState();
  const sessionId = `web-${actor}`;
  const session = await loadSessionState(sessionId, network);
  const history = await loadHistoryState(sessionId);
  const publicClient = createTempoPublicClient(networkConfig);
  const activeProfile = resolveActorProfile(actor, accounts.accounts);

  if (activeProfile) {
    session.activeProfile = activeProfile.name;
  }

  const context: ReplContext = {
    accounts,
    deployments,
    policies,
    history,
    session,
    network: networkConfig,
    publicClient,
    saveSession: saveSessionState,
    saveDeployments: saveDeploymentsState,
    savePolicies: savePoliciesState,
    saveHistory: saveHistoryState,
  };

  if (activeProfile) {
    context.activeProfile = activeProfile;
  }

  return context;
}

function resolveActorProfile(
  actor: WebActor,
  accounts: Record<string, AccountProfile>,
): AccountProfile | undefined {
  if (actor === "manager") {
    return undefined;
  }

  return accounts[normalizeProfileName(actor)];
}

async function readWebState() {
  await ensureLocalStateLayout();

  const env = loadPocEnv(repoRoot);
  const networkConfig = getTempoNetworkConfig(network, env);
  const accounts = await loadAccountsState();
  const deployments = await loadDeploymentsState();
  const policies = await loadPoliciesState();
  const manager = deployments.deployments.manager;

  return {
    network: {
      label: networkConfig.label,
      chainId: networkConfig.chainId,
      rpcUrl: networkConfig.rpcUrl,
      explorerUrl: networkConfig.explorerUrl,
    },
    accounts: Object.values(accounts.accounts)
      .map((account) => ({
        name: account.name,
        address: account.address,
        kind: account.kind,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    tokens: Object.values(deployments.deployments)
      .filter((deployment) => deployment.kind === "tip20")
      .map((token) => ({
        name: token.name,
        address: token.address,
        network: token.network,
        metadata: token.metadata ?? {},
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    policies: Object.values(policies.policies)
      .map((policy) => ({
        name: policy.name,
        id: policy.id,
        type: policy.type,
        admin: policy.admin,
        compound: policy.compound,
        members: Object.values(policy.members),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    manager: manager
      ? {
        address: manager.address,
        network: manager.network,
        metadata: manager.metadata ?? {},
      }
      : undefined,
    activity: await readRecentActivity(),
  };
}

async function readRecentActivity(): Promise<HistoryEntry[]> {
  const paths = getStatePaths(repoRoot);

  if (!existsSync(paths.historyDir)) {
    return [];
  }

  const files = await readdir(paths.historyDir);
  const historyFiles = files.filter((file) => file.endsWith(".history.json"));
  const entries: HistoryEntry[] = [];

  for (const file of historyFiles) {
    try {
      const raw = await readFile(join(paths.historyDir, file), "utf8");
      const history = JSON.parse(raw) as HistoryState;
      entries.push(...history.entries);
    } catch {
      // Ignore one malformed local history file so the UI can still load.
    }
  }

  return entries
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 25);
}

function createOutputBuffer(): OutputBuffer {
  return {
    text: "",
    write(chunk: string | Uint8Array): boolean {
      this.text += String(chunk);
      return true;
    },
  };
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  if (!raw) {
    throw new Error("Missing JSON body");
  }

  return JSON.parse(raw) as T;
}

async function serveStatic(pathname: string, headOnly: boolean, response: ServerResponse): Promise<void> {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = join(publicDir, relativePath);
  const resolvedPath = resolve(filePath);

  if (!resolvedPath.startsWith(publicDir) || !existsSync(resolvedPath)) {
    writeJson(response, 404, { ok: false, error: "Not found" });
    return;
  }

  response.writeHead(200, { "content-type": contentTypeFor(resolvedPath) });

  if (headOnly) {
    response.end();
    return;
  }

  const data = await readFile(resolvedPath);
  response.end(data);
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value, null, 2));
}

function contentTypeFor(filePath: string): string {
  const ext = extname(filePath);

  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";

  return "application/octet-stream";
}
