import type { createTempoPublicClient } from "../tempo/index.js";
import type {
  AccountProfile,
  AccountsState,
  DeploymentsState,
  HistoryState,
  PoliciesState,
  SessionState,
} from "../state/index.js";
import type { TempoNetworkConfig } from "../config/index.js";

export interface ReplContext {
  accounts: AccountsState;
  deployments: DeploymentsState;
  policies: PoliciesState;
  history: HistoryState;
  session: SessionState;
  network: TempoNetworkConfig;
  publicClient: ReturnType<typeof createTempoPublicClient>;
  activeProfile?: AccountProfile;
  saveSession: (session: SessionState) => Promise<void>;
  saveDeployments: (deployments: DeploymentsState) => Promise<void>;
  savePolicies: (policies: PoliciesState) => Promise<void>;
  saveHistory: (history: HistoryState) => Promise<void>;
}
