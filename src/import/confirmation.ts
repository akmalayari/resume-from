import { createHash, timingSafeEqual } from "node:crypto";
import type { SessionDescriptor } from "../session/contract.js";
import type { PreviewContent } from "./preview/contract.js";
import type { TransferPlan } from "./transfer/contract.js";

const TOKEN_PREFIX = "v1-sha256-";
const TOKEN_PATTERN = /^v1-sha256-[0-9a-f]{64}$/;

/** Binds confirmation to every input that can affect the imported session or its preview. */
export function confirmationToken(
  descriptor: SessionDescriptor,
  plan: TransferPlan,
  report: PreviewContent,
): string {
  const payload = stableJson({ descriptor, plan, report });
  return `${TOKEN_PREFIX}${createHash("sha256").update(payload).digest("hex")}`;
}

export function confirmationMatches(expected: string, supplied: string): boolean {
  if (!TOKEN_PATTERN.test(expected) || !TOKEN_PATTERN.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

/** JSON with recursively sorted object keys, so separate CLI processes derive the same token. */
function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, normalize(item)]),
  );
}
