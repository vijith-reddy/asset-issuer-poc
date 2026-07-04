import { Command } from "commander";
import { generateAndSaveProfiles, normalizeProfileName } from "../../cli/accounts/index.js";
import type { AccountKind } from "../../cli/state/index.js";
import type { GenerateProfilesOptions } from "../../cli/accounts/index.js";
import { fundAddressFromTempoFaucet } from "../../cli/tempo/index.js";

const allowedKinds = new Set<AccountKind>(["admin", "policyAdmin", "deployer", "user", "treasury", "operator"]);

const program = new Command()
  .name("generate-accounts")
  .description("Generate local secp256k1 account profiles for the USDV POC.")
  .argument("<names...>", "profile names, for example: admin alice bob policyAdmin")
  .option("--overwrite", "replace existing profiles with newly generated keys")
  .option("--kind <kind>", "default kind for names that do not imply a role")
  .option("--no-fund", "skip the Tempo testnet faucet request")
  .action(async (names: string[], options: { overwrite?: boolean; kind?: string; fund?: boolean }) => {
    const defaultKind = parseAccountKind(options.kind);
    const generateOptions: GenerateProfilesOptions = { overwrite: Boolean(options.overwrite) };

    if (defaultKind) {
      generateOptions.defaultKind = defaultKind;
    }

    const result = await generateAndSaveProfiles(names, generateOptions);

    for (const profile of result.created) {
      console.log(`created ${profile.name} (${profile.kind}) ${profile.address}`);
    }

    for (const profile of result.skipped) {
      console.log(`skipped ${profile.name} (${profile.kind}) ${profile.address}`);
    }

    if (options.fund !== false) {
      await fundRequestedProfiles(names, result.state);
    }
  });

await program.parseAsync();

function parseAccountKind(value: string | undefined): AccountKind | undefined {
  if (!value) return undefined;

  if (!allowedKinds.has(value as AccountKind)) {
    throw new Error(`Invalid kind "${value}". Expected one of: ${Array.from(allowedKinds).join(", ")}`);
  }

  return value as AccountKind;
}

async function fundRequestedProfiles(names: string[], state: Awaited<ReturnType<typeof generateAndSaveProfiles>>["state"]) {
  for (const rawName of names) {
    const profile = state.accounts[normalizeProfileName(rawName)];

    if (!profile) {
      continue;
    }

    const result = await fundAddressFromTempoFaucet(profile.address);

    if (!result.ok) {
      throw new Error(`Faucet funding failed for ${profile.name} (${result.status}): ${result.body}`);
    }

    console.log(`funded ${profile.name} ${profile.address}`);
  }
}
