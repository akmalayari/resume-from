import { describe, expect, test } from "vitest";
import type { CanonicalTurn } from "./contract.js";
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

function planOf(turns: CanonicalTurn[], windowTokens: number, share: number, recent: number) {
  return rules.apply(
    sessionOf(turns),
    targetOf(windowTokens),
    configOf(share, recent),
    charEstimator,
  );
}

describe("T-TRA-21 an empty session", () => {
  test("a plan with nothing in it, and no error", () => {
    const plan = planOf([], 200_000, 0.3, 5);

    expect(plan.turns).toEqual([]);
    expect(plan.pins).toEqual([]);
    expect(plan.drops).toEqual([]);
    expect(plan.keptTurnCount).toBe(0);
    expect(plan.droppedTurnCount).toBe(0);
    expect(plan.bodiesDropped).toBe(0);
    expect(plan.estimatedTokens).toBe(0);
    expect(plan.brokenTailDropped).toBe(false);
    // A plan that would keep zero turns is blocked, never silently empty (FR-33).
    expect(plan.blockedReason).toMatch(/nothing to import/i);
  });
});

describe("T-TRA-22 a session of only pinned turns, within budget", () => {
  test("nothing is dropped and nothing is blocked", () => {
    const turns = [
      userMessage(0, "The first request."),
      summaryTurn(1, "A summary the source made."),
      agentMessage(2, "The last answer."),
    ];

    const plan = planOf(turns, 1_000_000, 1, 3);

    expect(plan.drops).toEqual([]);
    expect(plan.blockedReason).toBeNull();
    expect(keptIndexes(plan)).toEqual([0, 1, 2]);
  });
});

describe("T-TRA-23 a budget of exactly the estimate", () => {
  test("at most, not less than: nothing is dropped", () => {
    const turns = [
      agentMessage(0, "x".repeat(120)),
      toolTurn(1, "Read", "'a.ts'", "400 lines"),
      agentMessage(2, "x".repeat(80)),
    ];
    const measured = planOf(turns, 1_000_000, 1, 0).estimatedTokens;

    const plan = planOf(turns, measured, 1, 0);

    expect(plan.budgetTokens).toBe(measured);
    expect(plan.estimatedTokens).toBe(measured);
    expect(plan.drops).toEqual([]);
    expect(plan.blockedReason).toBeNull();
  });
});

describe("T-TRA-24 one turn larger than the whole budget", () => {
  const huge = "x".repeat(500);

  test("unpinned, it is dropped and the plan fits", () => {
    const plan = planOf([agentMessage(0, huge)], 100, 1, 0);

    expect(droppedIndexes(plan)).toEqual([0]);
    expect(plan.turns).toEqual([]);
    expect(plan.estimatedTokens).toBeLessThanOrEqual(plan.budgetTokens);
    // Dropping the only turn leaves nothing to import, and an empty plan is blocked (FR-33).
    expect(plan.blockedReason).toMatch(/nothing to import/i);
  });

  test("pinned, the plan is blocked and the turn is never truncated", () => {
    const plan = planOf([userMessage(0, huge)], 100, 1, 0);

    expect(plan.blockedReason).not.toBeNull();
    expect(plan.drops).toEqual([]);
    expect(plan.turns[0]?.text).toBe(huge);
  });
});

describe("T-TRA-25 a tool call with no recorded outcome", () => {
  test("the outcome line says so in one line, and this is not a broken tail", () => {
    const turns = [
      userMessage(0, "Go."),
      toolTurn(1, "Read", "'a.ts'", ""),
      agentMessage(2, "Done."),
    ];

    const plan = planOf(turns, 1_000_000, 1, 5);
    const outcomeLine = plan.turns[1]?.toolCall?.outcomeLine ?? "";

    expect(plan.brokenTailDropped).toBe(false);
    expect(plan.drops).toEqual([]);
    expect(outcomeLine).toMatch(/not recorded/i);
    expect(outcomeLine).not.toMatch(/[\r\n]/);
  });
});

describe("T-TRA-26 an outcome that is many lines is reduced to one", () => {
  test("no line break survives into the outcome line", () => {
    const turns = [
      toolTurn(0, "shell", "'ls -la'", "total 48\r\ndrwxr-xr-x  6 me\n-rw-r--r--  1 me"),
    ];

    const plan = planOf(turns, 1_000_000, 1, 5);
    const outcomeLine = plan.turns[0]?.toolCall?.outcomeLine ?? "";

    expect(outcomeLine).not.toMatch(/[\r\n]/);
    expect(outcomeLine).toContain("total 48");
    expect(outcomeLine).toContain("-rw-r--r--  1 me");
  });
});

describe("T-TRA-28 a hostile session does not break the rules", () => {
  test("a turn of 10 MB", () => {
    const turns = [userMessage(0, "Go."), agentMessage(1, "x".repeat(10_000_000))];

    const plan = planOf(turns, 200_000, 0.3, 0);

    expect(droppedIndexes(plan)).toEqual([1]);
    expect(plan.estimatedTokens).toBeLessThanOrEqual(plan.budgetTokens);
    expect(plan.blockedReason).toBeNull();
  });

  test("a session of 100000 turns", { timeout: 30_000 }, () => {
    const turns = Array.from({ length: 100_000 }, (_, index) =>
      agentMessage(index, `turn ${index} of a very long session`),
    );

    const plan = planOf(turns, 200_000, 0.3, 5);

    expect(plan.keptTurnCount + plan.droppedTurnCount).toBe(100_000);
    expect(plan.estimatedTokens).toBeLessThanOrEqual(plan.budgetTokens);
  });

  test("arguments containing null bytes and a tool name that is empty", () => {
    const turns = [
      toolTurn(0, "", "'\u0000\u0000'", "\u0000", "mutating"),
      toolTurn(1, "Write", "\u0000", "wrote it", "mutating"),
    ];

    const plan = planOf(turns, 200_000, 0.3, 5);

    expect(plan.keptTurnCount).toBe(2);
    expect(plan.turns[0]?.toolCall?.toolName).toBe("");
    expect(plan.blockedReason).toBeNull();
    expect(plan.provenance.repo.changedPaths).toEqual([]);
  });
});
