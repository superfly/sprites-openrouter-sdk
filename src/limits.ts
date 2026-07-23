import type { ResolvedSpriteLimits, SpriteLimits } from "./types.js";

export const DEFAULT_LIMITS: Readonly<ResolvedSpriteLimits> = Object.freeze({
  commandTimeoutMs: 120_000,
  maxOutputBytes: 65_536,
  maxReadBytes: 262_144,
  maxSearchResults: 200,
});

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}
export function resolveLimits(limits: SpriteLimits = {}): ResolvedSpriteLimits {
  return {
    commandTimeoutMs: positiveInteger(
      "commandTimeoutMs",
      limits.commandTimeoutMs ?? DEFAULT_LIMITS.commandTimeoutMs,
    ),
    maxOutputBytes: positiveInteger(
      "maxOutputBytes",
      limits.maxOutputBytes ?? DEFAULT_LIMITS.maxOutputBytes,
    ),
    maxReadBytes: positiveInteger(
      "maxReadBytes",
      limits.maxReadBytes ?? DEFAULT_LIMITS.maxReadBytes,
    ),
    maxSearchResults: positiveInteger(
      "maxSearchResults",
      limits.maxSearchResults ?? DEFAULT_LIMITS.maxSearchResults,
    ),
  };
}
