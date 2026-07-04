import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readJsonFile<T>(filePath: string, fallback: () => T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isMissingFile(error)) {
      return fallback();
    }

    throw error;
  }
}

export async function writeJsonFile<T>(filePath: string, value: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  const body = `${JSON.stringify(value, null, 2)}\n`;
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  // Write then rename keeps readers from seeing half-written JSON.
  await writeFile(tmpPath, body, "utf8");
  await rename(tmpPath, filePath);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
