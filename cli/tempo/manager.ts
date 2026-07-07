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
const MANAGER_RUNTIME_ARTIFACT_PATH = "artifacts/MultiAssetLifecycleManager.json";
const LEGACY_MANAGER_RUNTIME_ARTIFACT_PATH = "artifacts/MockUSDVLifecycleManager.json";

export async function loadManagerArtifact(rootDir = process.cwd()): Promise<ManagerArtifact> {
  return loadArtifact(
    [MANAGER_ARTIFACT_PATH, MANAGER_RUNTIME_ARTIFACT_PATH],
    "Manager artifact not found. Run make build-contracts first.",
    rootDir,
  );
}

export async function loadLegacyManagerArtifact(rootDir = process.cwd()): Promise<ManagerArtifact> {
  return loadArtifact(
    [LEGACY_MANAGER_ARTIFACT_PATH, LEGACY_MANAGER_RUNTIME_ARTIFACT_PATH],
    "Legacy manager artifact not found. Run make build-contracts first.",
    rootDir,
  );
}

async function loadArtifact(paths: string[], missingMessage: string, rootDir: string): Promise<ManagerArtifact> {
  let lastMissingError: unknown;

  for (const path of paths) {
    const artifactPath = join(rootDir, path);

    try {
      return JSON.parse(await readFile(artifactPath, "utf8")) as ManagerArtifact;
    } catch (error) {
      if (isMissingFile(error)) {
        lastMissingError = error;
        continue;
      }

      throw error;
    }
  }

  if (lastMissingError) {
    throw new Error(missingMessage);
  }

  throw new Error(missingMessage);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
