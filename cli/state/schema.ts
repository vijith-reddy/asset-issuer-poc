export const STATE_VERSION = 1;

export type Address = `0x${string}`;
export type PrivateKey = `0x${string}`;
export type Hash = `0x${string}`;
export type NetworkName = "moderato" | "local";
export type SimplePolicyType = "whitelist" | "blacklist";
export type PolicyType = SimplePolicyType | "compound";
export type AccountKind = "admin" | "policyAdmin" | "deployer" | "user" | "treasury" | "operator";
export type HistoryStatus = "success" | "expected-failure";

export interface StateMeta {
  version: typeof STATE_VERSION;
  updatedAt: string;
}

export interface AccountProfile {
  name: string;
  address: Address;
  privateKey: PrivateKey;
  kind: AccountKind;
  createdAt: string;
}

export interface AccountsState extends StateMeta {
  accounts: Record<string, AccountProfile>;
}

export interface DeploymentRecord {
  name: string;
  address: Address;
  network: NetworkName;
  kind: "tip20" | "manager" | "mock" | "precompile" | "external";
  txHash?: Hash;
  createdAt: string;
  notes?: string;
  metadata?: Record<string, string>;
}

export interface DeploymentsState extends StateMeta {
  deployments: Record<string, DeploymentRecord>;
}

export interface PolicyMember {
  name: string;
  address: Address;
  // This mirrors the address being inside the TIP-403 policy set.
  // Whitelist: true means allowed. Blacklist: true means blocked.
  included: boolean;
  updatedAt: string;
}

export interface PolicyRecord {
  name: string;
  id: string;
  type: PolicyType;
  admin: string;
  network: NetworkName;
  members: Record<string, PolicyMember>;
  compound?: {
    senderPolicyName: string;
    senderPolicyId: string;
    recipientPolicyName: string;
    recipientPolicyId: string;
    mintRecipientPolicyName: string;
    mintRecipientPolicyId: string;
  };
  createdAt: string;
  txHash?: Hash;
}

export interface PoliciesState extends StateMeta {
  policies: Record<string, PolicyRecord>;
}

export interface SessionState extends StateMeta {
  sessionId: string;
  network: NetworkName;
  activeProfile?: string;
  activePolicy?: string;
  traceEnabled?: boolean;
}

export interface HistoryTxRef {
  label: string;
  hash: Hash;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  sessionId: string;
  network: NetworkName;
  action: string;
  status: HistoryStatus;
  summary: string;
  txs: HistoryTxRef[];
  profile?: string;
  error?: string;
  metadata?: Record<string, string>;
}

export interface HistoryState extends StateMeta {
  sessionId: string;
  entries: HistoryEntry[];
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createAccountsState(): AccountsState {
  return {
    version: STATE_VERSION,
    updatedAt: nowIso(),
    accounts: {},
  };
}

export function createDeploymentsState(): DeploymentsState {
  return {
    version: STATE_VERSION,
    updatedAt: nowIso(),
    deployments: {},
  };
}

export function createPoliciesState(): PoliciesState {
  return {
    version: STATE_VERSION,
    updatedAt: nowIso(),
    policies: {},
  };
}

export function createSessionState(sessionId: string, network: NetworkName): SessionState {
  return {
    version: STATE_VERSION,
    updatedAt: nowIso(),
    sessionId,
    network,
    traceEnabled: true,
  };
}

export function createHistoryState(sessionId: string): HistoryState {
  return {
    version: STATE_VERSION,
    updatedAt: nowIso(),
    sessionId,
    entries: [],
  };
}
