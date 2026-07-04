import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

export interface PocEnv {
  tempoTestnetRpcUrl: string;
  tempoFeeToken?: string;
}

const DEFAULT_TEMPO_TESTNET_RPC_URL = "https://rpc.moderato.tempo.xyz";

export function loadPocEnv(rootDir = process.cwd()): PocEnv {
  const envPath = join(rootDir, ".env");

  if (existsSync(envPath)) {
    loadDotenv({ path: envPath, quiet: true });
  }

  const env: PocEnv = {
    tempoTestnetRpcUrl: process.env.TEMPO_TESTNET_RPC_URL ?? DEFAULT_TEMPO_TESTNET_RPC_URL,
  };

  if (process.env.TEMPO_FEE_TOKEN) {
    env.tempoFeeToken = process.env.TEMPO_FEE_TOKEN;
  }

  return env;
}
