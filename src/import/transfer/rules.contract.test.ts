import { describe, expect, test } from "vitest";
import type { AgentId, CanonicalSession, CanonicalTurn, TransferPlan } from "./contract.js";
import {
  agentMessage,
  charEstimator,
  configOf,
  droppedIndexes,
  keptIndexes,
  sessionOf,
  summaryTurn,
  targetOf,
  toolTurn,
  userMessage,
} from "./fixtures.js";
import { createTransferRules } from "./rules.js";

const rules = createTransferRules();

/** A session with every shape the rules care about: messages, summaries, reads and edits. */
function mixedSession(size: number, brokenTail = false): CanonicalSession {
  const turns: CanonicalTurn[] = [];
  for (let index = 0; index < size; index += 1) {
    if (index === 0) {
      turns.push(userMessage(0, "The first request, which is always pinned."));
    } else if (index % 7 === 0) {
      turns.push(summaryTurn(index, `Compaction summary at ${index}.`));
    } else if (index % 11 === 0) {
      turns.push(toolTurn(index, "Edit", `'src/file-${index}.ts'`, "1 hunk", "mutating"));
    } else if (index % 3 === 0) {
      turns.push(toolTurn(index, "Read", `'src/file-${index}.ts'`, `${index} lines`));
    } else if (index % 2 === 0) {
      turns.push(agentMessage(index, `The agent answers at turn ${index}.`));
    } else {
      turns.push(userMessage(index, `The user asks something at turn ${index}.`));
    }
  }
  const last = turns[turns.length - 1];
  if (brokenTail && last) {
    turns[turns.length - 1] = toolTurn(last.index, "Edit", "'src/half-done.ts'", "", "mutating");
  }
  return sessionOf(turns);
}

const sizes = [0, 1, 20, 500];
const windows = [0, 200, 4000, 200_000];
const table = sizes.flatMap((size) =>
  windows.flatMap((windowTokens) =>
    [false, true].map((brokenTail) => ({ size, windowTokens, brokenTail })),
  ),
);

describe("T-TRA-16 the counts reconcile", () => {
  test.each(table)(
    "$size turns, a $windowTokens-token window, broken tail $brokenTail",
    ({ size, windowTokens, brokenTail }) => {
      const session = mixedSession(size, brokenTail);

      const plan = rules.apply(session, targetOf(windowTokens), configOf(1, 5), charEstimator);

      const budgetDrops = plan.drops.filter((drop) => drop.reason === "budget").length;
      expect(plan.keptTurnCount).toBe(plan.turns.length);
      expect(plan.drops).toHaveLength(plan.droppedTurnCount);
      expect(plan.keptTurnCount + plan.droppedTurnCount).toBe(session.turns.length);
      expect(plan.keptTurnCount + budgetDrops).toBe(
        session.turns.length - (plan.brokenTailDropped ? 1 : 0),
      );
    },
  );
});

describe("T-TRA-17 the plan fits the budget when it is not blocked", () => {
  test.each(table)(
    "$size turns, a $windowTokens-token window, broken tail $brokenTail",
    ({ size, windowTokens, brokenTail }) => {
      const session = mixedSession(size, brokenTail);

      const plan = rules.apply(session, targetOf(windowTokens), configOf(1, 5), charEstimator);

      if (plan.blockedReason === null) {
        expect(plan.estimatedTokens).toBeLessThanOrEqual(plan.budgetTokens);
      }
    },
  );
});

describe("T-TRA-18 indexes are source indexes", () => {
  test("the drops name 3, 4 and 5, and the kept turns keep their own numbers", () => {
    const turns = [
      summaryTurn(0, "x".repeat(100)),
      summaryTurn(1, "x".repeat(100)),
      summaryTurn(2, "x".repeat(100)),
      agentMessage(3, "x".repeat(100)),
      agentMessage(4, "x".repeat(100)),
      agentMessage(5, "x".repeat(100)),
      agentMessage(6, "x".repeat(100)),
      agentMessage(7, "x".repeat(100)),
      agentMessage(8, "x".repeat(100)),
      agentMessage(9, "x".repeat(100)),
    ];

    const plan = rules.apply(sessionOf(turns), targetOf(728), configOf(1, 4), charEstimator);

    expect(droppedIndexes(plan)).toEqual([3, 4, 5]);
    expect(keptIndexes(plan)).toEqual([0, 1, 2, 6, 7, 8, 9]);
  });
});

describe("T-TRA-19 the rules are pure", () => {
  const session = mixedSession(40);
  const target = targetOf(2000);
  const config = configOf(1, 5);

  test("a hundred calls and two instances all produce the same plan", () => {
    const first = createTransferRules().apply(session, target, config, charEstimator);

    for (let run = 0; run < 100; run += 1) {
      expect(rules.apply(session, target, config, charEstimator)).toEqual(first);
    }
    expect(createTransferRules().apply(session, target, config, charEstimator)).toEqual(first);
  });

  test("the input is left exactly as it was", () => {
    const before = structuredClone(session);

    rules.apply(session, target, config, charEstimator);

    expect(session).toEqual(before);
  });
});

describe("T-TRA-20 the rules never branch on the agent", () => {
  const agents: AgentId[] = ["pi", "codex", "claude-code", "fictitious-agent" as AgentId];

  function withoutTarget(plan: TransferPlan) {
    return { ...plan, target: null };
  }

  test("all four target agents give the same plan apart from the target", () => {
    const session = mixedSession(40);
    const config = configOf(1, 5);
    const expected = withoutTarget(
      rules.apply(session, targetOf(2000, "pi"), config, charEstimator),
    );

    for (const agent of agents) {
      const plan = rules.apply(session, targetOf(2000, agent), config, charEstimator);

      expect(withoutTarget(plan)).toEqual(expected);
      expect(plan.target.agent).toBe(agent);
    }
  });
});
