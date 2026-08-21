import type { RelayCountResponse } from "./types.js";

const HLL_HEX_LENGTH = 512;

export class RelayCountResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayCountResponseError";
  }
}

function decodeHll(value: string): Uint8Array {
  if (typeof value !== "string" || value.length !== HLL_HEX_LENGTH || !/^[0-9a-f]+$/i.test(value))
    throw new RelayCountResponseError("Invalid NIP-45 HLL value");

  const registers = new Uint8Array(256);
  for (let i = 0; i < registers.length; i++) registers[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return registers;
}

function encodeHll(registers: Uint8Array): string {
  return Array.from(registers, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function parseRelayCountResponse(value: unknown): RelayCountResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new RelayCountResponseError("COUNT response must be an object");

  const source = value as Record<string, unknown>;
  if (!Object.hasOwn(source, "count") || !Number.isSafeInteger(source.count) || (source.count as number) < 0)
    throw new RelayCountResponseError("COUNT response count must be a non-negative safe integer");
  if (Object.hasOwn(source, "approximate") && typeof source.approximate !== "boolean")
    throw new RelayCountResponseError("COUNT response approximate must be boolean");
  if (Object.hasOwn(source, "hll") && typeof source.hll !== "string")
    throw new RelayCountResponseError("COUNT response hll must be a string");

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) Object.defineProperty(result, key, { value: source[key], enumerable: true, writable: true, configurable: true });
  result.count = source.count;
  if (typeof source.approximate === "boolean") result.approximate = source.approximate;
  if (typeof source.hll === "string") result.hll = encodeHll(decodeHll(source.hll));
  return result as RelayCountResponse;
}

export function mergeHllRegisters(values: Iterable<string>): string {
  const merged = new Uint8Array(256);
  let seen = false;
  for (const value of values) {
    const registers = decodeHll(value);
    seen = true;
    for (let i = 0; i < merged.length; i++) merged[i] = Math.max(merged[i], registers[i]);
  }
  if (!seen) throw new RelayCountResponseError("At least one HLL value is required");
  return encodeHll(merged);
}

export function estimateHllCardinality(hll: string): number {
  const registers = decodeHll(hll);
  const m = registers.length;
  let sum = 0;
  let zeros = 0;
  for (const register of registers) {
    sum += 2 ** -register;
    if (register === 0) zeros++;
  }
  const raw = ((0.7213 / (1 + 1.079 / m)) * m * m) / sum;
  return raw <= 2.5 * m && zeros > 0 ? m * Math.log(m / zeros) : raw;
}
