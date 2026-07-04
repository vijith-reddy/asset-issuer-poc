import { formatUnits, parseUnits } from "viem";

export const TIP20_DECIMALS = 6;

export function parseTip20Amount(value: string): bigint {
  return parseUnits(value, TIP20_DECIMALS);
}

export function formatTip20Amount(value: bigint): string {
  return formatUnits(value, TIP20_DECIMALS);
}
