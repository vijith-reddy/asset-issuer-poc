import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGeneratedProfile, normalizeProfileName } from "../../cli/accounts/index.js";
import { handleDemoCommand } from "../../cli/commands/demo.js";
import { handleHistoryCommand, handleReceiptCommand } from "../../cli/commands/history.js";
import { handleManagerCommand } from "../../cli/commands/manager.js";
import { handleBalanceCommand, handleSendCommand } from "../../cli/commands/payments.js";
import { handlePolicyCommand } from "../../cli/commands/policy.js";
import { handleTokenCommand } from "../../cli/commands/token.js";
import { getTempoNetworkConfig, loadPocEnv } from "../../cli/config/index.js";
import type { ReplContext } from "../../cli/repl/index.js";
import {
  createAccountsState,
  createDeploymentsState,
  createHistoryState,
  createPoliciesState,
  createSessionState,
  ensureLocalStateLayout,
  getStatePaths,
  loadAccountsState,
  loadDeploymentsState,
  loadHistoryState,
  loadPoliciesState,
  loadSessionState,
  nowIso,
  saveDeploymentsState,
  saveHistoryState,
  savePoliciesState,
  saveSessionState,
  type AccountProfile,
  type AccountsState,
  type DeploymentsState,
  type HistoryEntry,
  type HistoryState,
  type NetworkName,
  type PoliciesState,
  type SessionState,
} from "../../cli/state/index.js";
import { createTempoPublicClient, fundAddressFromTempoFaucet } from "../../cli/tempo/index.js";
import { formatCliError } from "../../cli/utils/errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT ?? process.env.POC_WEB_PORT ?? 5177);
const network: NetworkName = "moderato";
const sessionCookieName = "asset_issuer_poc_session";
const defaultSessionTtlSeconds = 12 * 60 * 60;
const hostedSessionTtlSeconds = Number(process.env.POC_SESSION_TTL_SECONDS ?? defaultSessionTtlSeconds);
const hostedAutoFaucet = process.env.POC_HOSTED_AUTO_FAUCET !== "false";
const webProfileNames = ["admin", "policyAdmin", "deployer", "alice", "bob", "treasury"];
const hostedActorSessionIds = ["web-admin", "web-alice", "web-bob", "web-manager"];

type WebActor = "admin" | "manager" | "alice" | "bob";
type UpstashValue = string | number;

interface ActionRequest {
  actor: WebActor;
  command: string;
  args?: string[];
}

interface OutputBuffer {
  text: string;
  write: (chunk: string | Uint8Array) => boolean;
}

interface WebSessionRef {
  id: string;
  hosted: boolean;
  expiresAt?: string;
  ttlSeconds?: number;
}

const server = createServer(async (request, response) => {
  try {
    if (!request.url) {
      writeJson(response, 400, { ok: false, error: "Missing URL" });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "POST" && url.pathname === "/api/session/reset") {
      const currentSession = await resolveWebSession(request, response);
      const resetSession = await resetWebSession(currentSession, response);
      writeJson(response, 200, { ok: true, state: await readWebState(resetSession) });
      return;
    }

    const webSession = await resolveWebSession(request, response);

    if (request.method === "GET" && url.pathname === "/api/state") {
      writeJson(response, 200, { ok: true, state: await readWebState(webSession) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/action") {
      const body = await readJsonBody<ActionRequest>(request);
      const result = await runAction(body, webSession);
      writeJson(response, 200, { ok: true, ...result, state: await readWebState(webSession) });
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

async function runAction(body: ActionRequest, webSession: WebSessionRef): Promise<{ output: string }> {
  const args = body.args ?? [];
  const context = await loadWebContext(body.actor, webSession);
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

async function loadWebContext(actor: WebActor, webSession: WebSessionRef): Promise<ReplContext> {
  await ensureLocalStateLayout();

  const env = loadPocEnv(repoRoot);
  const networkConfig = getTempoNetworkConfig(network, env);
  const accounts = webSession.hosted ? await loadHostedAccounts(webSession.id) : await loadAccountsState();
  const deployments = webSession.hosted ? await loadHostedDeployments(webSession.id) : await loadDeploymentsState();
  const policies = webSession.hosted ? await loadHostedPolicies(webSession.id) : await loadPoliciesState();
  const sessionId = `web-${actor}`;
  const session = webSession.hosted ? await loadHostedSession(webSession.id, sessionId) : await loadSessionState(sessionId, network);
  const history = webSession.hosted ? await loadHostedHistory(webSession.id, sessionId) : await loadHistoryState(sessionId);
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
    saveSession: webSession.hosted ? (nextSession) => saveHostedSession(webSession.id, nextSession) : saveSessionState,
    saveDeployments: webSession.hosted ? (nextDeployments) => saveHostedDeployments(webSession.id, nextDeployments) : saveDeploymentsState,
    savePolicies: webSession.hosted ? (nextPolicies) => saveHostedPolicies(webSession.id, nextPolicies) : savePoliciesState,
    saveHistory: webSession.hosted ? (nextHistory) => saveHostedHistory(webSession.id, nextHistory) : saveHistoryState,
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

async function readWebState(webSession: WebSessionRef) {
  await ensureLocalStateLayout();

  const env = loadPocEnv(repoRoot);
  const networkConfig = getTempoNetworkConfig(network, env);
  const accounts = webSession.hosted ? await loadHostedAccounts(webSession.id) : await loadAccountsState();
  const deployments = webSession.hosted ? await loadHostedDeployments(webSession.id) : await loadDeploymentsState();
  const policies = webSession.hosted ? await loadHostedPolicies(webSession.id) : await loadPoliciesState();
  const manager = deployments.deployments.manager;

  return {
    session: {
      id: webSession.id,
      hosted: webSession.hosted,
      expiresAt: webSession.expiresAt,
      ttlSeconds: webSession.ttlSeconds,
    },
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
    activity: await readRecentActivity(webSession),
  };
}

async function readRecentActivity(webSession: WebSessionRef): Promise<HistoryEntry[]> {
  if (webSession.hosted) {
    const histories = await Promise.all(
      hostedActorSessionIds.map((sessionId) => loadHostedHistory(webSession.id, sessionId)),
    );

    return histories
      .flatMap((history) => history.entries)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 25);
  }

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

async function resolveWebSession(request: IncomingMessage, response: ServerResponse): Promise<WebSessionRef> {
  if (!hostedSessionsEnabled()) {
    return {
      id: "local",
      hosted: false,
    };
  }

  const existingSessionId = readCookie(request, sessionCookieName);
  const sessionId = existingSessionId && isSafeSessionId(existingSessionId) ? existingSessionId : randomUUID();
  const session = hostedSessionRef(sessionId);
  setSessionCookie(response, session);
  await ensureHostedSession(sessionId);
  await refreshHostedSession(sessionId);

  return session;
}

async function resetWebSession(currentSession: WebSessionRef, response: ServerResponse): Promise<WebSessionRef> {
  if (!hostedSessionsEnabled()) {
    throw new Error("Reset Project is available in hosted session mode only.");
  }

  if (currentSession.hosted) {
    await deleteHostedSession(currentSession.id);
  }

  const nextSession = hostedSessionRef(randomUUID());
  setSessionCookie(response, nextSession);
  await ensureHostedSession(nextSession.id);

  return nextSession;
}

function hostedSessionRef(sessionId: string): WebSessionRef {
  return {
    id: sessionId,
    hosted: true,
    expiresAt: new Date(Date.now() + hostedSessionTtlSeconds * 1000).toISOString(),
    ttlSeconds: hostedSessionTtlSeconds,
  };
}

async function ensureHostedSession(sessionId: string): Promise<void> {
  const accounts = await hostedGetJson<AccountsState>(hostedKey(sessionId, "accounts"));

  if (accounts && Object.keys(accounts.accounts).length > 0) {
    return;
  }

  const nextAccounts = createAccountsState();

  for (const name of webProfileNames) {
    const profile = createGeneratedProfile(name);
    nextAccounts.accounts[profile.name] = profile;
  }

  nextAccounts.updatedAt = nowIso();
  await saveHostedAccounts(sessionId, nextAccounts);
  await saveHostedDeployments(sessionId, createDeploymentsState());
  await saveHostedPolicies(sessionId, createPoliciesState());

  for (const actorSessionId of hostedActorSessionIds) {
    await saveHostedSession(sessionId, createSessionState(actorSessionId, network));
    await saveHostedHistory(sessionId, createHistoryState(actorSessionId));
  }

  if (hostedAutoFaucet) {
    await faucetHostedAccounts(nextAccounts);
  }
}

async function faucetHostedAccounts(accounts: AccountsState): Promise<void> {
  await Promise.allSettled(
    Object.values(accounts.accounts).map((account) => fundAddressFromTempoFaucet(account.address)),
  );
}

async function refreshHostedSession(sessionId: string): Promise<void> {
  await Promise.allSettled(hostedSessionKeys(sessionId).map((key) => upstashCommand(["EXPIRE", key, hostedSessionTtlSeconds])));
}

async function deleteHostedSession(sessionId: string): Promise<void> {
  await upstashCommand(["DEL", ...hostedSessionKeys(sessionId)]);
}

function hostedSessionKeys(sessionId: string): string[] {
  return [
    hostedKey(sessionId, "accounts"),
    hostedKey(sessionId, "deployments"),
    hostedKey(sessionId, "policies"),
    ...hostedActorSessionIds.flatMap((actorSessionId) => [
      hostedKey(sessionId, `session:${actorSessionId}`),
      hostedKey(sessionId, `history:${actorSessionId}`),
    ]),
  ];
}

function loadHostedAccounts(sessionId: string): Promise<AccountsState> {
  return hostedLoadJson(hostedKey(sessionId, "accounts"), createAccountsState);
}

function saveHostedAccounts(sessionId: string, state: AccountsState): Promise<void> {
  return hostedSaveJson(hostedKey(sessionId, "accounts"), state);
}

function loadHostedDeployments(sessionId: string): Promise<DeploymentsState> {
  return hostedLoadJson(hostedKey(sessionId, "deployments"), createDeploymentsState);
}

function saveHostedDeployments(sessionId: string, state: DeploymentsState): Promise<void> {
  return hostedSaveJson(hostedKey(sessionId, "deployments"), state);
}

function loadHostedPolicies(sessionId: string): Promise<PoliciesState> {
  return hostedLoadJson(hostedKey(sessionId, "policies"), createPoliciesState);
}

function saveHostedPolicies(sessionId: string, state: PoliciesState): Promise<void> {
  return hostedSaveJson(hostedKey(sessionId, "policies"), state);
}

function loadHostedSession(sessionId: string, actorSessionId: string): Promise<SessionState> {
  return hostedLoadJson(hostedKey(sessionId, `session:${actorSessionId}`), () => createSessionState(actorSessionId, network));
}

function saveHostedSession(sessionId: string, state: SessionState): Promise<void> {
  state.updatedAt = nowIso();
  return hostedSaveJson(hostedKey(sessionId, `session:${state.sessionId}`), state);
}

function loadHostedHistory(sessionId: string, actorSessionId: string): Promise<HistoryState> {
  return hostedLoadJson(hostedKey(sessionId, `history:${actorSessionId}`), () => createHistoryState(actorSessionId));
}

function saveHostedHistory(sessionId: string, state: HistoryState): Promise<void> {
  state.updatedAt = nowIso();
  return hostedSaveJson(hostedKey(sessionId, `history:${state.sessionId}`), state);
}

async function hostedLoadJson<T>(key: string, factory: () => T): Promise<T> {
  return await hostedGetJson<T>(key) ?? factory();
}

async function hostedGetJson<T>(key: string): Promise<T | undefined> {
  const result = await upstashCommand<string | null>(["GET", key]);
  return result ? JSON.parse(result) as T : undefined;
}

async function hostedSaveJson(key: string, value: unknown): Promise<void> {
  await upstashCommand(["SET", key, JSON.stringify(value), "EX", hostedSessionTtlSeconds]);
}

async function upstashCommand<T>(command: UpstashValue[]): Promise<T> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !restToken) {
    throw new Error("Hosted session storage is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.");
  }

  const response = await fetch(restUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${restToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error(`Hosted session storage failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json() as { result?: T; error?: string };

  if (payload.error) {
    throw new Error(`Hosted session storage failed: ${payload.error}`);
  }

  return payload.result as T;
}

function hostedKey(sessionId: string, name: string): string {
  return `asset-issuer-poc:${sessionId}:${name}`;
}

function hostedSessionsEnabled(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function readCookie(request: IncomingMessage, name: string): string | undefined {
  const cookie = request.headers.cookie;

  if (!cookie) {
    return undefined;
  }

  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");

    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return undefined;
}

function setSessionCookie(response: ServerResponse, session: WebSessionRef): void {
  if (!session.hosted) {
    return;
  }

  const secure = process.env.VERCEL ? "; Secure" : "";
  const cookie = `${sessionCookieName}=${encodeURIComponent(session.id)}; Path=/; Max-Age=${hostedSessionTtlSeconds}; HttpOnly; SameSite=Lax${secure}`;
  const existing = response.getHeader("set-cookie");
  const next = Array.isArray(existing) ? [...existing, cookie] : existing ? [String(existing), cookie] : cookie;
  response.setHeader("set-cookie", next);
}

function isSafeSessionId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(value);
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
