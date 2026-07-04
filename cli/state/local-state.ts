import { getHistoryFile, getSessionFile, getStatePaths, type StatePaths } from "./paths.js";
import { ensureDir, readJsonFile, writeJsonFile } from "./json-store.js";
import {
  createAccountsState,
  createDeploymentsState,
  createHistoryState,
  createPoliciesState,
  createSessionState,
  nowIso,
  type NetworkName,
  type AccountsState,
  type DeploymentsState,
  type HistoryState,
  type PoliciesState,
  type SessionState,
} from "./schema.js";

export async function ensureLocalStateLayout(paths = getStatePaths()): Promise<void> {
  await ensureDir(paths.stateDir);
  await ensureDir(paths.sessionsDir);
  await ensureDir(paths.historyDir);
}

export async function loadAccountsState(paths = getStatePaths()): Promise<AccountsState> {
  return readJsonFile(paths.accountsFile, createAccountsState);
}

export async function saveAccountsState(state: AccountsState, paths = getStatePaths()): Promise<void> {
  await writeJsonFile(paths.accountsFile, state);
}

export async function loadDeploymentsState(paths = getStatePaths()): Promise<DeploymentsState> {
  return readJsonFile(paths.deploymentsFile, createDeploymentsState);
}

export async function saveDeploymentsState(state: DeploymentsState, paths = getStatePaths()): Promise<void> {
  await writeJsonFile(paths.deploymentsFile, state);
}

export async function loadPoliciesState(paths = getStatePaths()): Promise<PoliciesState> {
  return readJsonFile(paths.policiesFile, createPoliciesState);
}

export async function savePoliciesState(state: PoliciesState, paths = getStatePaths()): Promise<void> {
  await writeJsonFile(paths.policiesFile, state);
}

export async function loadSessionState(
  sessionId: string,
  network: NetworkName,
  paths = getStatePaths(),
): Promise<SessionState> {
  return readJsonFile(getSessionFile(paths, sessionId), () => createSessionState(sessionId, network));
}

export async function saveSessionState(state: SessionState, paths = getStatePaths()): Promise<void> {
  state.updatedAt = nowIso();
  await writeJsonFile(getSessionFile(paths, state.sessionId), state);
}

export async function loadHistoryState(sessionId: string, paths = getStatePaths()): Promise<HistoryState> {
  return readJsonFile(getHistoryFile(paths, sessionId), () => createHistoryState(sessionId));
}

export async function saveHistoryState(state: HistoryState, paths = getStatePaths()): Promise<void> {
  state.updatedAt = nowIso();
  await writeJsonFile(getHistoryFile(paths, state.sessionId), state);
}

export type { StatePaths };
