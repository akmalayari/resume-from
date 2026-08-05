// The listing order. It is a total order, because FR-10 lets the user see the rows in one
// invocation and name row 3 in the next one.

import type { SessionDescriptor, SessionRef } from "./contract.js";

/** An unreadable timestamp sorts last rather than making the comparison unstable. */
function timeOf(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareRef(a: SessionRef, b: SessionRef): number {
  return compareText(a.agent, b.agent) || compareText(a.home, b.home) || compareText(a.id, b.id);
}

/** Newest first across every agent and home (FR-14, FR-15); ties broken by `SessionRef`. */
export function compareDescriptors(a: SessionDescriptor, b: SessionDescriptor): number {
  const left = timeOf(a.updatedAt);
  const right = timeOf(b.updatedAt);
  if (left !== right) return right > left ? 1 : -1;
  return compareRef(a.ref, b.ref);
}
