import type { Address } from "../state/index.js";

export interface FaucetFundResult {
  address: Address;
  ok: boolean;
  status: number;
  body: string;
}

export interface FaucetOptions {
  endpoint?: string;
}

const DEFAULT_FAUCET_ENDPOINT = "https://tempo.xyz/developers/api/faucet";

export async function fundAddressFromTempoFaucet(
  address: Address,
  options: FaucetOptions = {},
): Promise<FaucetFundResult> {
  const endpoint = options.endpoint ?? DEFAULT_FAUCET_ENDPOINT;

  // The Tempo faucet docs ask for a lowercase wallet address in the JSON body.
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: address.toLowerCase() }),
  });

  const body = await response.text();

  return {
    address,
    ok: response.ok,
    status: response.status,
    body,
  };
}
