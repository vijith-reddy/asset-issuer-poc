import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Abi, Hex } from "viem";

export interface ManagerArtifact {
  abi: Abi;
  bytecode: {
    object: Hex;
  };
}

const MANAGER_ARTIFACT_PATH = "out/MockUSDVLifecycleManager.sol/MockUSDVLifecycleManager.json";

export async function loadManagerArtifact(rootDir = process.cwd()): Promise<ManagerArtifact> {
  const artifactPath = join(rootDir, MANAGER_ARTIFACT_PATH);

  try {
    return JSON.parse(await readFile(artifactPath, "utf8")) as ManagerArtifact;
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error("Manager artifact not found. Run make build-contracts first.");
    }

    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
