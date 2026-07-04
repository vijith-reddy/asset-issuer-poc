import { getAddress, isAddress } from "viem";
import { normalizeProfileName } from "../accounts/index.js";
import type { AccountsState, Address } from "../state/index.js";
import { formatUnknownProfileOrAddressMessage } from "./profile-hints.js";

export interface ResolvedAddress {
  label: string;
  address: Address;
  isKnownProfile: boolean;
}

export function resolveAddress(value: string, accounts: AccountsState): ResolvedAddress {
  const profile = accounts.accounts[normalizeProfileName(value)];

  if (profile) {
    return {
      label: profile.name,
      address: profile.address,
      isKnownProfile: true,
    };
  }

  if (!isAddress(value)) {
    throw new Error(formatUnknownProfileOrAddressMessage(value));
  }

  return {
    label: getAddress(value),
    address: getAddress(value),
    isKnownProfile: false,
  };
}
