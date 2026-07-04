import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AccountProfile } from "../state/index.js";
import type { TempoNetworkConfig } from "../config/index.js";

export function createTempoPublicClient(network: TempoNetworkConfig) {
  return createPublicClient({
    chain: network.chain,
    transport: http(network.rpcUrl),
  });
}

export function createTempoWalletClient(profile: AccountProfile, network: TempoNetworkConfig) {
  // The profile private key turns into a Viem account only when this client is needed.
  const account = privateKeyToAccount(profile.privateKey);

  return createWalletClient({
    account,
    chain: network.chain,
    transport: http(network.rpcUrl),
  });
}
