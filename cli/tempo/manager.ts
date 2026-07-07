import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Abi, Hex } from "viem";

export interface ManagerArtifact {
  abi: Abi;
  bytecode: {
    object: Hex;
  };
}

const MANAGER_ARTIFACT_PATH = "out/MultiAssetLifecycleManager.sol/MultiAssetLifecycleManager.json";
const LEGACY_MANAGER_ARTIFACT_PATH = "out/MockUSDVLifecycleManager.sol/MockUSDVLifecycleManager.json";

export async function loadManagerArtifact(rootDir = process.cwd()): Promise<ManagerArtifact> {
  return loadArtifact(MANAGER_ARTIFACT_PATH, "Manager artifact not found. Run make build-contracts first.", rootDir);
}

export async function loadLegacyManagerArtifact(rootDir = process.cwd()): Promise<ManagerArtifact> {
  return loadArtifact(LEGACY_MANAGER_ARTIFACT_PATH, "Legacy manager artifact not found. Run make build-contracts first.", rootDir);
}

async function loadArtifact(path: string, missingMessage: string, rootDir: string): Promise<ManagerArtifact> {
  const artifactPath = join(rootDir, path);

  try {
    return JSON.parse(await readFile(artifactPath, "utf8")) as ManagerArtifact;
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(missingMessage);
    }

    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
