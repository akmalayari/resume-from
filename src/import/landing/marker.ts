import type { ProvenanceMarker, TransferPlan } from "./contract.js";

const NOTHING_DROPPED = "Nothing was dropped: the whole session crossed over.";
const DROPPED_PREFIX = "Dropped on import: ";
const PART_SEPARATOR = "; ";

function counted(amount: number, one: string, many: string): string {
  return `${amount} ${amount === 1 ? one : many}`;
}

/** One line naming what the rules removed (FR-47). Never more than one line. */
export function summariseDrops(plan: TransferPlan): string {
  const parts: string[] = [];
  if (plan.droppedTurnCount > 0) parts.push(counted(plan.droppedTurnCount, "turn", "turns"));
  if (plan.bodiesDropped > 0) {
    parts.push(counted(plan.bodiesDropped, "tool result body", "tool result bodies"));
  }
  const brokenTails = plan.drops.filter((drop) => drop.reason === "broken-tail").length;
  if (brokenTails === 1) parts.push("an incomplete trailing tool call");
  if (brokenTails > 1) parts.push(`${brokenTails} incomplete trailing tool calls`);
  if (parts.length === 0) return NOTHING_DROPPED;
  return `${DROPPED_PREFIX}${parts.join(PART_SEPARATOR)}.`;
}

/**
 * The provenance marker the user sees (FR-47). `lines` renders the same facts
 * in the order they must be shown; where they are shown is the adapter's
 * declared capability (FR-48), not this module's decision.
 */
export function buildMarker(plan: TransferPlan, importedAt: string): ProvenanceMarker {
  const { ref } = plan.provenance;
  const droppedSummary = summariseDrops(plan);
  return {
    sourceAgent: ref.agent,
    sourceHome: ref.home,
    sourceSessionId: ref.id,
    importedAt,
    droppedSummary,
    lines: [
      `Imported from ${ref.agent}`,
      `Source home: ${ref.home}`,
      `Source session: ${ref.id}`,
      `Imported at: ${importedAt}`,
      droppedSummary,
    ],
  };
}
