import { createHmac, randomInt } from "node:crypto";

/**
 * ADR-010 / docs/MASKING.md — masked identifiers.
 *
 * TV-#### is random, immutable, never reused, and never derived from any candidate
 * attribute. Sequential allocation would leak listing order, which correlates with
 * bulk-upload batches, which correlates with vendor identity. Deriving it from a name
 * would be reversible by dictionary attack.
 */

const MASKED_ID_MIN = 1000;
const MASKED_ID_MAX = 9999;
export const MASKED_ID_SPACE = MASKED_ID_MAX - MASKED_ID_MIN + 1;

/** Widen the format beyond four digits once occupancy passes this share. */
export const WIDEN_AT_OCCUPANCY = 0.3;

/**
 * Allocate an unused TV-#### at random. `taken` is the set of already-issued values,
 * including retired ones: IDs are never reused, so a retired ID stays in the set.
 */
export function allocateMaskedId(taken: ReadonlySet<string>): string {
  const occupancy = taken.size / MASKED_ID_SPACE;
  if (occupancy >= WIDEN_AT_OCCUPANCY) return allocateWide(taken);

  // Rejection sampling. At <30% occupancy the expected number of tries is < 1.5.
  for (let i = 0; i < 1000; i++) {
    const candidate = `TV-${randomInt(MASKED_ID_MIN, MASKED_ID_MAX + 1)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return allocateWide(taken);
}

function allocateWide(taken: ReadonlySet<string>): string {
  for (let i = 0; i < 10_000; i++) {
    const candidate = `TV-${randomInt(10_000, 100_000)}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("allocateMaskedId: exhausted the widened space");
}

/* ---------- identity hashing ---------- */

/**
 * HMAC with a server-side pepper, not a bare hash. A bare SHA-256 of a 10-character
 * PAN is brute-forceable in seconds. Ops-only columns; never leaves the server.
 */
export function identityHash(value: string, pepper = process.env.IDENTITY_PEPPER): string {
  if (!pepper) throw new Error("IDENTITY_PEPPER is not set — refusing to write a bare hash");
  const normalised = value.trim().toLowerCase().replace(/\s+/g, "");
  return createHmac("sha256", pepper).update(normalised).digest("hex");
}

/** The design shows truncated hashes on the duplicates screen, e.g. "…7f21c9". */
export function hashTail(hash: string, chars = 6): string {
  return `…${hash.slice(-chars)}`;
}
