import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ensureLocalStateLayout,
  loadAccountsState,
  saveAccountsState,
  type StatePaths,
} from "../state/local-state.js";
import {
  nowIso,
  type AccountKind,
  type AccountProfile,
  type AccountsState,
} from "../state/schema.js";

const PROFILE_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export interface GenerateProfilesOptions {
  overwrite?: boolean;
  defaultKind?: AccountKind;
}

export interface GenerateProfilesResult {
  created: AccountProfile[];
  skipped: AccountProfile[];
  state: AccountsState;
}

export function normalizeProfileName(name: string): string {
  return name.trim().toLowerCase();
}

export function assertValidProfileName(name: string): string {
  const normalized = normalizeProfileName(name);

  if (!PROFILE_NAME_PATTERN.test(normalized)) {
    throw new Error(`Invalid profile name "${name}". Use letters, numbers, "_" or "-", starting with a letter.`);
  }

  return normalized;
}

export function inferAccountKind(name: string, fallback: AccountKind = "user"): AccountKind {
  const normalized = normalizeProfileName(name);

  if (normalized === "admin") return "admin";
  if (normalized === "policyadmin" || normalized === "policy-admin") return "policyAdmin";
  if (normalized === "deployer") return "deployer";
  if (normalized === "treasury") return "treasury";
  if (normalized === "operator") return "operator";

  return fallback;
}

export function createGeneratedProfile(name: string, kind = inferAccountKind(name)): AccountProfile {
  const profileName = assertValidProfileName(name);
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const createdAt = nowIso();

  return {
    name: profileName,
    address: account.address,
    privateKey,
    kind,
    createdAt,
  };
}

export async function generateAndSaveProfiles(
  names: string[],
  options: GenerateProfilesOptions = {},
  paths?: StatePaths,
): Promise<GenerateProfilesResult> {
  await ensureLocalStateLayout(paths);

  const state = await loadAccountsState(paths);
  const created: AccountProfile[] = [];
  const skipped: AccountProfile[] = [];

  for (const rawName of names) {
    const name = assertValidProfileName(rawName);
    const existing = state.accounts[name];

    if (existing && !options.overwrite) {
      skipped.push(existing);
      continue;
    }

    // Each profile is a normal secp256k1 EOA. Tempo deployments must use this kind of root key.
    const profile = createGeneratedProfile(name, inferAccountKind(name, options.defaultKind));
    state.accounts[name] = profile;
    created.push(profile);
  }

  state.updatedAt = nowIso();
  await saveAccountsState(state, paths);

  return { created, skipped, state };
}

export function listAccountProfiles(state: AccountsState): AccountProfile[] {
  return Object.values(state.accounts).sort((left, right) => left.name.localeCompare(right.name));
}
