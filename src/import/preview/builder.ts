import type {
  PreviewBuilder,
  PreviewContent,
  PreviewWarning,
  RepoReader,
  TransferPlan,
} from "./contract.js";
import { formatTokens, oneLine, plural } from "./format.js";
import { planWarnings, repoWarning, sortWarnings } from "./warnings.js";

/** Paths are longer than titles and are not shortened to the same length. */
const MAX_PATH_LENGTH = 160;
const MAX_REASON_LENGTH = 200;
const UNTITLED = "(untitled)";

// Each blockedReason now carries its own cause-specific advice (FR-33, FR-56), so no
// single fallback string is accurate for all block causes.

function headerLines(plan: TransferPlan): string[] {
  const source = plan.provenance.ref;
  const title = oneLine(plan.provenance.title) || UNTITLED;
  return [
    `Source: ${source.agent} — ${title} (${oneLine(source.home, MAX_PATH_LENGTH)})`,
    `Target: ${plan.target.agent} (${oneLine(plan.target.home, MAX_PATH_LENGTH)})`,
    countLine(plan),
  ];
}

/** FR-17: both counts, and both come from the plan. */
function countLine(plan: TransferPlan): string {
  const kept = plan.keptTurnCount;
  const crossing =
    kept === 0
      ? "Nothing would cross over"
      : `${kept} ${plural(kept, "turn crosses", "turns cross")} over`;
  return plan.droppedTurnCount > 0 ? `${crossing}, ${plan.droppedTurnCount} dropped` : crossing;
}

/** FR-35. A plan that dropped nothing produces no line at all — never "0 turns dropped". */
function dropLines(plan: TransferPlan): string[] {
  const lines: string[] = [];
  const budgetDrops = plan.drops.filter((drop) => drop.reason === "budget").length;
  if (budgetDrops > 0) {
    lines.push(`${budgetDrops} older ${plural(budgetDrops, "turn", "turns")} dropped`);
  }
  if (plan.bodiesDropped > 0) {
    lines.push(
      `${plan.bodiesDropped} tool result ${plural(plan.bodiesDropped, "body", "bodies")} dropped`,
    );
  }
  return lines;
}

function blockedLines(blockedReason: string | null): string[] {
  if (blockedReason === null) return [];
  return [`✖ The import cannot run: ${oneLine(blockedReason, MAX_REASON_LENGTH)}`];
}

/**
 * Builds the preview from a plan and the repository state read at the moment of the call.
 * It writes nothing (FR-16) and renders one shape for every direction (FR-21).
 */
export function createPreviewBuilder(repo: RepoReader, cwd: string): PreviewBuilder {
  return {
    async build(plan: TransferPlan): Promise<PreviewContent> {
      const collected: PreviewWarning[] = planWarnings(plan);
      const fromRepo = await repoWarning(plan, repo, cwd);
      if (fromRepo !== null) collected.push(fromRepo);
      const warnings = sortWarnings(collected);

      const header = headerLines(plan);
      const budgetLine = `Budget: ${formatTokens(plan.estimatedTokens)} tokens of a ${formatTokens(plan.target.windowTokens)} window`;
      const drops = dropLines(plan);
      const blocked = plan.blockedReason !== null;

      return {
        headerLines: header,
        budgetLine,
        warnings,
        dropLines: drops,
        blocked,
        blockedReason: plan.blockedReason,
        lines: [
          ...header,
          budgetLine,
          ...warnings.map((warning) => warning.line),
          ...drops,
          ...blockedLines(plan.blockedReason),
        ],
      };
    },
  };
}
