export function formatCliError(error: unknown): string {
  const message = errorToMessage(error);

  if (message.startsWith("TIP-403 policy blocked")) {
    return message;
  }

  if (isPolicyForbidsError(error)) {
    return [
      "TIP-403 policy blocked this operation (PolicyForbids).",
      "The token contract rejected the sender or recipient under its transfer policy.",
      "Use: policy check <profile|address>",
    ].join("\n");
  }

  return message;
}

export function isPolicyForbidsError(error: unknown): boolean {
  const text = collectErrorText(error).toLowerCase();

  return text.includes("policyforbids") || text.includes("0x54cfe659");
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function collectErrorText(error: unknown, seen = new Set<unknown>()): string {
  if (error === null || error === undefined) {
    return "";
  }

  if (typeof error === "string" || typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }

  if (typeof error !== "object") {
    return "";
  }

  if (seen.has(error)) {
    return "";
  }

  seen.add(error);

  const source = error as Record<string, unknown>;
  const parts: string[] = [];

  for (const key of ["name", "shortMessage", "message", "details"]) {
    const value = source[key];

    if (typeof value === "string") {
      parts.push(value);
    }
  }

  if (Array.isArray(source.metaMessages)) {
    parts.push(...source.metaMessages.filter((value): value is string => typeof value === "string"));
  }

  if (source.cause) {
    parts.push(collectErrorText(source.cause, seen));
  }

  if (source.data) {
    parts.push(collectErrorText(source.data, seen));
  }

  return parts.filter(Boolean).join("\n");
}
