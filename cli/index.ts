import { Command } from "commander";
import { normalizeProfileName } from "./accounts/index.js";
import { getTempoNetworkConfig, loadPocEnv } from "./config/index.js";
import { runRepl, type ReplContext } from "./repl/index.js";
import {
  createTempoPublicClient,
} from "./tempo/index.js";
import {
  ensureLocalStateLayout,
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
  type NetworkName,
} from "./state/index.js";

interface CliOptions {
  as?: string;
  session?: string;
  network?: NetworkName;
}

const program = new Command()
  .name("poc")
  .description("Interactive USDV on Tempo POC console.")
  .option("--as <profile>", "start the console as a named local profile, for example alice")
  .option("--session <id>", "session id for this terminal; defaults to the selected profile or default")
  .option("--network <network>", "local state network label: moderato or local", "moderato");

program.parse();

await main(program.opts<CliOptions>());

async function main(options: CliOptions): Promise<void> {
  await ensureLocalStateLayout();

  const env = loadPocEnv();
  const accounts = await loadAccountsState();
  const deployments = await loadDeploymentsState();
  const policies = await loadPoliciesState();
  const network = parseNetwork(options.network);
  const networkConfig = getTempoNetworkConfig(network, env);
  const publicClient = createTempoPublicClient(networkConfig);
  const sessionId = options.session ?? (options.as ? normalizeProfileName(options.as) : "default");
  const session = await loadSessionState(sessionId, network);
  const history = await loadHistoryState(sessionId);
  let activeProfile = resolveActiveProfile(session.activeProfile, accounts.accounts);

  if (options.as) {
    const profileName = normalizeProfileName(options.as);
    const profile = accounts.accounts[profileName];

    if (!profile) {
      throw new Error(`Unknown profile "${options.as}". Generate it first or choose an existing profile.`);
    }

    // Keep the private key in memory only. The prompt shows the name, never the secret.
    activeProfile = profile;
    session.activeProfile = profile.name;
    await saveSessionState(session);
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

  await runRepl(context);
}

function resolveActiveProfile(
  profileName: string | undefined,
  accounts: Record<string, AccountProfile>,
): AccountProfile | undefined {
  if (!profileName) {
    return undefined;
  }

  return accounts[normalizeProfileName(profileName)];
}

function parseNetwork(value: NetworkName | undefined): NetworkName {
  if (value === "moderato" || value === "local") {
    return value;
  }

  throw new Error(`Invalid network "${value}". Expected moderato or local.`);
}
