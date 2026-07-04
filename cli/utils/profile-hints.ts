import { assertValidProfileName } from "../accounts/index.js";

interface UnknownProfileMessageOptions {
  retryCommand?: string;
}

export function formatProfileCreateCommand(profileName: string): string | undefined {
  try {
    const normalized = assertValidProfileName(profileName);

    return `make accounts-generate NAMES="${normalized}"`;
  } catch {
    return undefined;
  }
}

export function formatUnknownProfileMessage(
  profileName: string,
  options: UnknownProfileMessageOptions = {},
): string {
  const createCommand = formatProfileCreateCommand(profileName);

  if (!createCommand) {
    return [
      `No profile exists with name "${profileName}".`,
      `Profile names must use letters, numbers, "_" or "-", starting with a letter.`,
    ].join("\n");
  }

  const lines = [
    `No profile exists with name "${profileName}".`,
    `Create it with: ${createCommand}`,
  ];

  if (options.retryCommand) {
    lines.push(`Then retry with: ${options.retryCommand}`);
  }

  return lines.join("\n");
}

export function formatUnknownProfileOrAddressMessage(value: string): string {
  const createCommand = formatProfileCreateCommand(value);

  if (!createCommand) {
    return [
      `Unknown profile or invalid address: ${value}`,
      `If this is an address, pass a valid 0x address.`,
      `If this is a profile name, use letters, numbers, "_" or "-", starting with a letter.`,
    ].join("\n");
  }

  return [
    `Unknown profile or invalid address: ${value}`,
    `If "${value}" should be a local profile, create it with: ${createCommand}`,
    `Otherwise pass a valid 0x address.`,
  ].join("\n");
}
