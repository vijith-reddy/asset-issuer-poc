import { getAddress, isAddress, type Address, type Chain } from "viem";
import { tempoLocalnet, tempoModerato } from "viem/chains";
import type { NetworkName } from "../state/index.js";
import type { PocEnv } from "./env.js";

const DEFAULT_MODERATO_FEE_TOKEN = "0x20c0000000000000000000000000000000000000";

export interface TempoNetworkConfig {
  key: NetworkName;
  label: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl?: string;
  feeToken?: Address;
  chain: Chain;
}

export function getTempoNetworkConfig(network: NetworkName, env: PocEnv): TempoNetworkConfig {
  if (network === "moderato") {
    const feeToken = resolveFeeToken(env.tempoFeeToken ?? DEFAULT_MODERATO_FEE_TOKEN);

    return {
      key: "moderato",
      label: "Tempo Testnet (Moderato)",
      chainId: 42431,
      rpcUrl: env.tempoTestnetRpcUrl,
      explorerUrl: "https://explore.testnet.tempo.xyz",
      feeToken,
      chain: tempoModerato.extend({
        feeToken,
        rpcUrls: {
          default: {
            http: [env.tempoTestnetRpcUrl],
            webSocket: ["wss://rpc.moderato.tempo.xyz"],
          },
        },
      }),
    };
  }

  return {
    key: "local",
    label: "Local Tempo",
    chainId: tempoLocalnet.id,
    rpcUrl: tempoLocalnet.rpcUrls.default.http[0],
    chain: tempoLocalnet,
  };
}

function resolveFeeToken(value: string): Address {
  if (!isAddress(value)) {
    throw new Error(`Invalid TEMPO_FEE_TOKEN: ${value}`);
  }

  return getAddress(value);
}
