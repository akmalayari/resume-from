import { rmSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { readSessionText } from "../../adapters/claude-code/reader.js";
import {
  assistantToolUseEntry,
  chainEntries,
  userEntry,
  uuidFor,
} from "../../adapters/claude-code/test-support.js";
import { readRollout } from "../../adapters/codex/read.js";
import {
  functionCall,
  makeTempHome,
  metaEntry,
  userEvent,
  writeRollout,
} from "../../adapters/codex/test-support.js";
import { piSessionText, piToolCallDraft, piUserDraft } from "../../adapters/pi/fixtures.js";
import { entriesToTurns, parseSessionText } from "../../adapters/pi/parse.js";
import type { AgentId, CanonicalTurn, TransferPlan } from "./contract.js";
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

describe("T-TRA-29 a large session leaves room to work", () => {
  /**
   * C-5's measurement: of the source transcript, the visible conversation is about 10%,
   * hidden reasoning about 41%, and tool calls with their outputs about 49%. The reasoning
   * and the output bodies have no field in the canonical vocabulary, so they are carried
   * here as fields that must never reach the plan.
   */
  function measuredSession() {
    const turns: CanonicalTurn[] = [];
    const reasoning = "REASONING-".repeat(2000);
    const body = "OUTPUT-BODY-".repeat(2000);
    for (let round = 0; round < 40; round += 1) {
      const index = round * 3;
      turns.push(
        withExtras(userMessage(index, `Question ${round}: ${"q".repeat(400)}`), { reasoning }),
      );
      turns.push(
        withExtras(agentMessage(index + 1, `Answer ${round}: ${"a".repeat(600)}`), { reasoning }),
      );
      turns.push(
        withExtras(toolTurn(index + 2, "Read", `'src/file-${round}.ts'`, `${round} lines`), {
          resultText: body,
        }),
      );
    }
    return sessionOf(turns);
  }

  test("the plan fits 30% of a 200000-token window and the conversation survives", () => {
    const session = measuredSession();

    const plan = rules.apply(session, targetOf(200_000), configOf(0.3, 5), charEstimator);

    expect(plan.budgetTokens).toBe(60_000);
    expect(plan.estimatedTokens).toBeLessThanOrEqual(60_000);
    expect(plan.blockedReason).toBeNull();
    expect(plan.drops).toEqual([]);
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain("REASONING-");
    expect(serialized).not.toContain("OUTPUT-BODY-");
    for (let round = 0; round < 40; round += 1) {
      expect(serialized).toContain(`Question ${round}:`);
      expect(serialized).toContain(`Answer ${round}:`);
    }
  });
});

describe("T-TRA-30 the same rules for all nine directions", () => {
  const agents: AgentId[] = ["pi", "codex", "claude-code"];

  function shapeOf(plan: TransferPlan) {
    return { ...plan, target: null, provenance: null };
  }

  function sourceSession(sourceAgent: AgentId) {
    const turns = [
      userMessage(0, "Fix the login redirect."),
      toolTurn(1, "Read", "'src/auth.ts'", "400 lines"),
      toolTurn(2, "Edit", "'src/auth.ts'", "1 hunk", "mutating"),
      summaryTurn(3, "We rewrote the redirect."),
      agentMessage(4, "The redirect now keeps the query string."),
    ];
    const provenance = provenanceOf(sourceAgent);
    provenance.repo.changedPaths = ["src/auth.ts"];
    return sessionOf(turns, provenance);
  }

  test("nine combinations give nine identical plans apart from target and provenance", () => {
    const plans = agents.flatMap((sourceAgent) =>
      agents.map((targetAgent) =>
        rules.apply(
          sourceSession(sourceAgent),
          targetOf(200_000, targetAgent),
          configOf(0.3, 5),
          charEstimator,
        ),
      ),
    );

    expect(plans).toHaveLength(9);
    const first = plans[0];
    if (!first) throw new Error("no plan");
    for (const plan of plans) {
      expect(shapeOf(plan)).toEqual(shapeOf(first));
      expect(plan.provenance.repo.changedPaths).toEqual(["src/auth.ts"]);
    }
  });
});

describe("T-TRA-31 the thread survives the budget", () => {
  test("a 60-turn session at a 20% budget keeps the pins and drops the middle", () => {
    const turns: CanonicalTurn[] = [userMessage(0, `The first request. ${"f".repeat(480)}`)];
    for (let index = 1; index < 60; index += 1) {
      if (index === 15 || index === 35) {
        turns.push(summaryTurn(index, `Summary at ${index}. ${"s".repeat(480)}`));
      } else if (index === 20) {
        turns.push(toolTurn(index, "Edit", "'src/auth.ts'", "1 hunk", "mutating"));
      } else if (index === 21) {
        turns.push(toolTurn(index, "Write", "'src/session.ts'", "40 lines", "mutating"));
      } else if (index % 2 === 0) {
        turns.push(agentMessage(index, `Answer at ${index}. ${"a".repeat(480)}`));
      } else {
        turns.push(userMessage(index, `Question at ${index}. ${"q".repeat(480)}`));
      }
    }

    const provenance = provenanceOf();
    provenance.repo.changedPaths = ["src/auth.ts", "src/session.ts"];
    const plan = rules.apply(
      sessionOf(turns, provenance),
      targetOf(100_000),
      configOf(0.2, 5),
      charEstimator,
    );

    const kept = keptIndexes(plan);
    expect(plan.blockedReason).toBeNull();
    expect(kept).toContain(0);
    expect(kept).toContain(15);
    expect(kept).toContain(35);
    expect(kept).toEqual(expect.arrayContaining([55, 56, 57, 58, 59]));
    expect(plan.provenance.repo.changedPaths).toEqual(["src/auth.ts", "src/session.ts"]);
    expect(pinnedIndexes(plan.pins, "changed-files")).toEqual([20, 21]);
    // What went is the unpinned middle, not the ends.
    const dropped = droppedIndexes(plan);
    expect(dropped.length).toBeGreaterThan(10);
    expect(dropped).not.toContain(0);
    expect(dropped).not.toContain(15);
    expect(dropped).not.toContain(35);
    expect(Math.min(...dropped)).toBe(1);
    expect(Math.max(...dropped)).toBeLessThan(55);
  });
});

describe("T-TRA-32 a same-agent move still drops bodies", () => {
  test("Claude Code to Claude Code in another home drops the body just the same", () => {
    const secret = "line 42 of the real file";
    const turns = [
      userMessage(0, "Read the auth file."),
      withExtras(toolTurn(1, "Read", "'src/auth.ts'", "Read('src/auth.ts') → 400 lines"), {
        resultText: secret,
      }),
    ];
    const session = sessionOf(turns, provenanceOf("claude-code"));

    const plan = rules.apply(
      session,
      {
        agent: "claude-code",
        home: "/homes/claude-code-team",
        windowTokens: 200_000,
      },
      configOf(0.3, 5),
      charEstimator,
    );

    expect(JSON.stringify(plan)).not.toContain(secret);
    expect(plan.turns[1]?.toolCall?.bodyDropped).toBe(true);
    expect(plan.turns[1]?.toolCall?.outcomeLine.endsWith(MARKER)).toBe(true);
    expect(plan.bodiesDropped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T-TRA-33: broken-tail detection cross-adapter (FR-54)
//
// The hasBrokenTail() signal is only useful if it actually fires. These tests
// cross the adapter→rules seam that previously hid the bug: the adapters set
// resultRecorded = false for a tool call whose result entry never arrived, and
// the rules must drop that turn and set brokenTailDropped = true.
//
// Test files are excluded from shippedSources(), so importing adapters here
// does not violate the architecture gate (T-ROO-7, T-ROO-10).
// ---------------------------------------------------------------------------

const CTX = { cwd: "/work/app", gitBranch: "main", sessionId: "s-broken" };

describe("T-TRA-33 broken-tail detection survives per-adapter round-trip", () => {
  test("claude-code: resultRecorded = false and brokenTailDropped = true when tool result is absent", () => {
    // An assistant entry with a tool_use block but no subsequent tool_result entry.
    const text = chainEntries([
      userEntry(CTX, uuidFor(1), "2026-01-01T00:00:00.000Z", "Fix auth."),
      assistantToolUseEntry(CTX, uuidFor(2), "2026-01-01T00:00:01.000Z", "toolu_01", "Edit", {
        file_path: "src/auth.ts",
      }),
    ])
      .map((entry) => JSON.stringify(entry))
      .join("\n");

    const read = readSessionText(text);
    expect(read.unreadable).toBeNull();
    const last = read.turns.at(-1);
    // Verify the adapter signal before testing the rules.
    expect(last?.kind).toBe("tool-call");
    expect(last?.toolCall?.resultRecorded).toBe(false);

    const session = { provenance: provenanceOf("claude-code"), turns: read.turns };
    const plan = rules.apply(session, targetOf(200_000), configOf(0.3, 5), charEstimator);

    expect(plan.brokenTailDropped).toBe(true);
    // The broken-tail turn must not cross over — not just flagged but absent from the plan.
    expect(keptIndexes(plan)).not.toContain(last?.index);
  });

  test("pi: resultRecorded = false and brokenTailDropped = true when tool result entry is absent", () => {
    // A session ending in a toolCall message with no following toolResult entry.
    const { text } = piSessionText([
      piUserDraft("Fix auth."),
      piToolCallDraft("tc-1", "Edit", { file_path: "src/auth.ts" }),
    ]);

    const parsed = parseSessionText(text);
    const loaded = entriesToTurns(parsed.entries);
    expect(loaded.unreadable).toBeNull();
    const last = loaded.turns.at(-1);
    // Verify the adapter signal before testing the rules.
    expect(last?.kind).toBe("tool-call");
    expect(last?.toolCall?.resultRecorded).toBe(false);

    const session = { provenance: provenanceOf("pi"), turns: loaded.turns };
    const plan = rules.apply(session, targetOf(200_000), configOf(0.3, 5), charEstimator);

    expect(plan.brokenTailDropped).toBe(true);
    // The broken-tail turn must not cross over — not just flagged but absent from the plan.
    expect(keptIndexes(plan)).not.toContain(last?.index);
  });

  test("codex: resultRecorded = false and brokenTailDropped = true when function_call_output is absent", async () => {
    const home = makeTempHome();
    try {
      // A rollout with a function_call entry but no function_call_output entry.
      const filePath = writeRollout(home, "s-broken", [
        metaEntry("s-broken"),
        userEvent("Fix auth."),
        functionCall("apply_patch", '{"input":"*** Begin Patch\\n"}', "call_1"),
        // no functionCallOutput("call_1", ...) — the session was interrupted
      ]);

      const rollout = await readRollout(filePath);
      const last = rollout.turns.at(-1);
      // Verify the adapter signal before testing the rules.
      expect(last?.kind).toBe("tool-call");
      expect(last?.toolCall?.resultRecorded).toBe(false);

      const session = { provenance: provenanceOf("codex"), turns: rollout.turns };
      const plan = rules.apply(session, targetOf(200_000), configOf(0.3, 5), charEstimator);

      expect(plan.brokenTailDropped).toBe(true);
      // The broken-tail turn must not cross over — not just flagged but absent from the plan.
      expect(keptIndexes(plan)).not.toContain(last?.index);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
