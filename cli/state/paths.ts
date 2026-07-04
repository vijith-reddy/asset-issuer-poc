import { join } from "node:path";

export interface StatePaths {
  rootDir: string;
  stateDir: string;
  accountsFile: string;
  deploymentsFile: string;
  policiesFile: string;
  sessionsDir: string;
  historyDir: string;
}

export function getStatePaths(rootDir = process.cwd()): StatePaths {
  const stateDir = join(rootDir, ".poc");

  return {
    rootDir,
    stateDir,
    accountsFile: join(stateDir, "accounts.local.json"),
    deploymentsFile: join(stateDir, "deployments.local.json"),
    policiesFile: join(stateDir, "policies.local.json"),
    sessionsDir: join(stateDir, "sessions"),
    historyDir: join(stateDir, "history"),
  };
}

export function getSessionFile(paths: StatePaths, sessionId: string): string {
  return join(paths.sessionsDir, `${safeFilePart(sessionId)}.session.json`);
}

export function getHistoryFile(paths: StatePaths, sessionId: string): string {
  return join(paths.historyDir, `${safeFilePart(sessionId)}.history.json`);
}

// Session names come from CLI input, so keep them boring before using them in paths.
function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
