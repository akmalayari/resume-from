import { describe, expect, test } from "vitest";
import type { CanonicalTurn, TransferPlan } from "./contract.js";
import {
  agentMessage,
  charEstimator,
  configOf,
  droppedIndexes,
  keptIndexes,
  pinnedIndexes,
  provenanceOf,
  sessionOf,
  summaryTurn,
  targetOf,
  toolTurn,
  userMessage,
  withExtras,
} from "./fixtures.js";
import { createTransferRules } from "./rules.js";

const MARKER = "(content dropped: imported session, may be stale)";

const rules = createTransferRules();

/** A budget nothing in these fixtures can exceed. */
function unlimited(pinnedRecentTurns = 5) {
  return {
    target: targetOf(1_000_000),
    config: configOf(1, pinnedRecentTurns),
  };
}

function planOf(turns: CanonicalTurn[], windowTokens: number, share: number, recent: number) {
  return rules.apply(
    sessionOf(turns),
    targetOf(windowTokens),
    configOf(share, recent),
    charEstimator,
  );
}

function recordOf(plan: TransferPlan, position: number) {
  const record = plan.turns[position]?.toolCall;
  if (!record) throw new Error(`no tool record at position ${position}`);
  return record;
}

describe("T-TRA-1 visible content always crosses", () => {
  test("user message, agent answer and compaction summary all cross unchanged", () => {
    const turns = [
      userMessage(0, "Make the login form validate the e-mail."),
      agentMessage(1, "Done. I changed the validator."),
      summaryTurn(2, "Earlier: we rewrote the session store."),
    ];
    const { target, config } = unlimited();

    const plan = rules.apply(sessionOf(turns), target, config, charEstimator);

    expect(plan.turns).toEqual(turns);
    expect(keptIndexes(plan)).toEqual([0, 1, 2]);
    expect(plan.turns.map((turn) => turn.text)).toEqual([
      "Make the login form validate the e-mail.",
      "Done. I changed the validator.",
      "Earlier: we rewrote the session store.",
    ]);
  });
});

describe("T-TRA-2 a tool call becomes a record", () => {
  test("name, arguments and one outcome line survive; nothing else does", () => {
    const turns = [toolTurn(0, "Read", "'src/auth.ts'", "Read('src/auth.ts') → 400 lines")];
    const { target, config } = unlimited();

    const plan = rules.apply(sessionOf(turns), target, config, charEstimator);
    const record = recordOf(plan, 0);

    expect(plan.turns[0]?.kind).toBe("tool-call");
    expect(record.toolName).toBe("Read");
    expect(record.argumentsText).toBe("'src/auth.ts'");
    expect(record.outcomeLine.startsWith("Read('src/auth.ts') → 400 lines")).toBe(true);
    expect(Object.keys(record).sort()).toEqual(
      ["argumentsText", "bodyDropped", "effect", "outcomeLine", "toolName"].sort(),
    );
  });

  test("with no body to drop the outcome line is exactly what the source recorded", () => {
    const turns = [
      toolTurn(0, "Read", "'src/auth.ts'", "Read('src/auth.ts') → 400 lines", "read-only", false),
    ];
    const { target, config } = unlimited();

    const plan = rules.apply(sessionOf(turns), target, config, charEstimator);

    expect(recordOf(plan, 0).outcomeLine).toBe("Read('src/auth.ts') → 400 lines");
  });
});

describe("T-TRA-3 every result body is dropped and marked", () => {
  test("the body never appears, every record is marked, and the count reports it", () => {
    const secret = "SECRET-BODY-CONTENT";
    const turns = [
      withExtras(toolTurn(0, "Read", "'a.ts'", "Read('a.ts') → 400 lines"), {
        resultText: `line 1\n${secret}\nline 3`,
      }),
      withExtras(toolTurn(1, "Grep", "'auth'", "Grep('auth') → 12 matches"), {
        result: { body: secret },
      }),
      userMessage(2, "Carry on."),
    ];
    const { target, config } = unlimited();

    const plan = rules.apply(sessionOf(turns), target, config, charEstimator);

    expect(JSON.stringify(plan)).not.toContain(secret);
    expect(recordOf(plan, 0).bodyDropped).toBe(true);
    expect(recordOf(plan, 1).bodyDropped).toBe(true);
    expect(recordOf(plan, 0).outcomeLine.endsWith(MARKER)).toBe(true);
    expect(recordOf(plan, 1).outcomeLine.endsWith(MARKER)).toBe(true);
    expect(plan.bodiesDropped).toBe(2);
  });

  test("a body the budget later dropped is still counted: step 2 removed it either way", () => {
    const turns = [
      toolTurn(0, "Read", "'a.ts'", `Read('a.ts') → ${"x".repeat(200)}`),
      agentMessage(1, "x".repeat(100)),
    ];

    const plan = planOf(turns, 100, 1, 0);

    expect(droppedIndexes(plan)).toEqual([0]);
    expect(plan.bodiesDropped).toBe(1);
  });
});

describe("T-TRA-4 tool names are not translated", () => {
  const names = ["Read", "Edit", "shell", "apply_patch", "Frobnicate"];

  test.each(names)("%s stays %s", (name) => {
    const turns = [toolTurn(0, name, "'x'", "ok")];
    const { target, config } = unlimited();

    const plan = rules.apply(sessionOf(turns), target, config, charEstimator);

    expect(recordOf(plan, 0).toolName).toBe(name);
  });
});

describe("T-TRA-5 a mutating call is marked and carries no instruction to run", () => {
  test("the edit is a record of text, not something the target can execute", () => {
    const turns = [
      toolTurn(0, "Edit", "'src/auth.ts'", "Edit('src/auth.ts') → 1 hunk", "mutating"),
    ];
    const { target, config } = unlimited();

    const plan = rules.apply(sessionOf(turns), target, config, charEstimator);
    const record = recordOf(plan, 0);

    expect(record.effect).toBe("mutating");
    expect(typeof record.argumentsText).toBe("string");
    expect(typeof record.outcomeLine).toBe("string");
    // Nothing in the plan is callable: it survives a JSON round trip untouched.
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });
});

describe("T-TRA-6 excluded content never crosses", () => {
  test("reasoning, prompts, environment values, telemetry and vendor state are all absent", () => {
    const excluded = {
      reasoning: "HIDDEN-CHAIN-OF-THOUGHT",
      systemPrompt: "SYSTEM-PROMPT-TEXT",
      developerPrompt: "DEVELOPER-PROMPT-TEXT",
      env: { OPENAI_API_KEY: "sk-LEAKED-KEY" },
      telemetry: { runId: "TELEMETRY-RUN-ID" },
      vendorState: "VENDOR-MODEL-STATE",
    };
    const turns = [
      withExtras(userMessage(0, "Fix the bug."), excluded),
      withExtras(agentMessage(1, "Fixed."), { thinking: "HIDDEN-CHAIN-OF-THOUGHT" }),
    ];
    const session = withExtras(sessionOf(turns, withExtras(provenanceOf(), excluded)), excluded);

    const plan = rules.apply(
      session,
      withExtras(targetOf(), excluded),
      configOf(1, 5),
      charEstimator,
    );

    const serialized = JSON.stringify(plan);
    for (const secret of [
      "HIDDEN-CHAIN-OF-THOUGHT",
      "SYSTEM-PROMPT-TEXT",
      "DEVELOPER-PROMPT-TEXT",
      "OPENAI_API_KEY",
      "sk-LEAKED-KEY",
      "TELEMETRY-RUN-ID",
      "VENDOR-MODEL-STATE",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("T-TRA-7 the budget is the share of the window", () => {
  test.each([
    [200_000, 0.3, 60_000],
    [200_000, 0.25, 50_000],
    [200_000, 1, 200_000],
    [50_000, 0.3, 15_000],
  ])("a %i-token window at %s gives %i", (windowTokens, share, expected) => {
    const plan = planOf([userMessage(0, "hi")], windowTokens, share, 5);

    expect(plan.budgetTokens).toBe(expected);
  });
});

describe("T-TRA-8 the first request is pinned", () => {
  test("the oldest turn survives a budget that drops the turns after it", () => {
    const turns: CanonicalTurn[] = [userMessage(0, "x".repeat(100))];
    for (let index = 1; index < 10; index += 1) {
      turns.push(agentMessage(index, "x".repeat(100)));
    }

    const plan = planOf(turns, 300, 1, 0);

    expect(plan.pins).toContainEqual({ index: 0, reason: "first-request" });
    expect(droppedIndexes(plan)).not.toContain(0);
    expect(keptIndexes(plan)).toEqual([0, 8, 9]);
  });
});

describe("T-TRA-9 the last N turns are pinned", () => {
  const turns = Array.from({ length: 20 }, (_, index) => agentMessage(index, `turn ${index}`));

  test.each([
    [0, []],
    [1, [19]],
    [5, [15, 16, 17, 18, 19]],
    [50, Array.from({ length: 20 }, (_, index) => index)],
  ])("pinnedRecentTurns %i pins %j", (recent, expected) => {
    const plan = planOf(turns, 1_000_000, 1, recent);

    expect(pinnedIndexes(plan.pins, "recent-turn")).toEqual(expected);
  });
});

describe("T-TRA-10 summaries and the changed-file list are pinned", () => {
  test("both summaries and all three mutating calls are protected", () => {
    const turns = [
      userMessage(0, "Start."),
      summaryTurn(1, "Summary one."),
      toolTurn(2, "Edit", "'a.ts'", "Edit('a.ts') → 1 hunk", "mutating"),
      toolTurn(3, "Write", "'b.ts'", "Write('b.ts') → 20 lines", "mutating"),
      summaryTurn(4, "Summary two."),
      toolTurn(5, "Edit", "'c.ts'", "Edit('c.ts') → 2 hunks", "mutating"),
      agentMessage(6, "Done."),
    ];

    const plan = planOf(turns, 1_000_000, 1, 0);

    expect(pinnedIndexes(plan.pins, "summary")).toEqual([1, 4]);
    expect(pinnedIndexes(plan.pins, "changed-files")).toEqual([2, 3, 5]);
    expect(plan.provenance.repo.changedPaths).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});

describe("T-TRA-11 the oldest unpinned turns are dropped first", () => {
  test("drops are the lowest source indexes, ascending, and stop as soon as the plan fits", () => {
    const turns = Array.from({ length: 10 }, (_, index) => agentMessage(index, "x".repeat(100)));

    const plan = planOf(turns, 600, 1, 0);

    expect(droppedIndexes(plan)).toEqual([0, 1, 2, 3]);
    expect(plan.estimatedTokens).toBe(600);
    expect(keptIndexes(plan)).toEqual([4, 5, 6, 7, 8, 9]);
  });
});

describe("T-TRA-12 a call and its result are never split", () => {
  const call = toolTurn(0, "Read", "'src/auth.ts'", "Read('src/auth.ts') → 400 lines");
  const message = agentMessage(1, "x".repeat(100));

  test("when the budget cuts at the record it is dropped whole", () => {
    const plan = planOf([call, message], 100, 1, 0);

    expect(droppedIndexes(plan)).toEqual([0]);
    expect(keptIndexes(plan)).toEqual([1]);
    expect(plan.estimatedTokens).toBe(100);
  });

  test("when the record is kept the outcome is kept with it", () => {
    const plan = planOf([call, message], 1_000_000, 1, 0);
    const record = recordOf(plan, 0);

    expect(plan.drops).toEqual([]);
    expect(record.outcomeLine.startsWith("Read('src/auth.ts') → 400 lines")).toBe(true);
    expect(record.bodyDropped).toBe(true);
  });
});

describe("T-TRA-13 a broken tail is dropped", () => {
  test("a trailing call with no result is removed and reported", () => {
    const turns = [
      userMessage(0, "Fix it."),
      agentMessage(1, "Reading the file."),
      toolTurn(2, "Edit", "'a.ts'", "", "mutating"),
    ];

    const plan = planOf(turns, 1_000_000, 1, 5);

    expect(plan.brokenTailDropped).toBe(true);
    expect(plan.drops).toContainEqual({ index: 2, reason: "broken-tail" });
    expect(keptIndexes(plan)).toEqual([0, 1]);
  });

  test("a complete trailing call is not a broken tail", () => {
    const turns = [userMessage(0, "Fix it."), toolTurn(1, "Edit", "'a.ts'", "1 hunk", "mutating")];

    const plan = planOf(turns, 1_000_000, 1, 5);

    expect(plan.brokenTailDropped).toBe(false);
    expect(plan.drops).toEqual([]);
  });
});

describe("T-TRA-14 pinned content over budget blocks", () => {
  test("the block states what to change and no pin is dropped", () => {
    const turns = [userMessage(0, "x".repeat(5000))];

    const plan = planOf(turns, 1000, 1, 5);

    expect(plan.budgetTokens).toBe(1000);
    expect(plan.blockedReason).not.toBeNull();
    expect(plan.blockedReason).toContain("budgetShare");
    expect(plan.blockedReason).toContain("pinnedRecentTurns");
    expect(plan.drops).toEqual([]);
    expect(keptIndexes(plan)).toEqual([0]);
    // The blocked plan reports the cost of everything it selected, so estimatedTokens
    // still describes `turns` and can be read against budgetTokens.
    expect(plan.estimatedTokens).toBe(planOf(turns, 1_000_000, 1, 5).estimatedTokens);
    expect(plan.estimatedTokens).toBeGreaterThan(plan.budgetTokens);
  });
});

describe("T-TRA-15 the changed-file list is derived from mutating calls", () => {
  test("only the mutating calls contribute a path", () => {
    const turns = [
      toolTurn(0, "Edit", "'a.ts'", "Edit('a.ts') → 1 hunk", "mutating"),
      toolTurn(1, "Write", "'b.ts'", "Write('b.ts') → 20 lines", "mutating"),
      toolTurn(2, "Read", "'c.ts'", "Read('c.ts') → 400 lines", "read-only"),
    ];

    const plan = planOf(turns, 1_000_000, 1, 5);

    expect(plan.provenance.repo.changedPaths).toEqual(["a.ts", "b.ts"]);
  });
});
