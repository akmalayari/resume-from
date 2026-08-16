// T-TRA-27 — no input or output. Inside `sealed` the filesystem, the network, the clock and
// randomness all throw. The rules take everything as arguments, so every scenario below must
// still produce a plan. The seal is closed only around the call itself, so the test runner —
// which legitimately reads a clock — keeps working.

import { describe, expect, test, vi } from "vitest";
import type { CanonicalTurn } from "./contract.js";
import {
  agentMessage,
  brokenToolTurn,
  charEstimator,
  configOf,
  sessionOf,
  summaryTurn,
  targetOf,
  toolTurn,
  userMessage,
} from "./fixtures.js";
import { createTransferRules } from "./rules.js";

vi.mock("node:fs", () => {
  throw new Error("the filesystem is forbidden: the transfer rules are pure");
});
vi.mock("node:fs/promises", () => {
  throw new Error("the filesystem is forbidden: the transfer rules are pure");
});
vi.mock("node:child_process", () => {
  throw new Error("spawning a process is forbidden: the transfer rules are pure");
});
vi.mock("node:http", () => {
  throw new Error("the network is forbidden: the transfer rules are pure");
});
vi.mock("node:https", () => {
  throw new Error("the network is forbidden: the transfer rules are pure");
});
vi.mock("node:net", () => {
  throw new Error("the network is forbidden: the transfer rules are pure");
});
vi.mock("node:dns", () => {
  throw new Error("the network is forbidden: the transfer rules are pure");
});

const rules = createTransferRules();

/** Runs fn with the clock, randomness and the network stubbed to throw. */
function sealed<T>(fn: () => T): T {
  const now = vi.spyOn(Date, "now").mockImplementation(() => {
    throw new Error("the clock is forbidden");
  });
  const random = vi.spyOn(Math, "random").mockImplementation(() => {
    throw new Error("randomness is forbidden");
  });
  const realFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: () => {
      throw new Error("the network is forbidden");
    },
  });
  try {
    return fn();
  } finally {
    now.mockRestore();
    random.mockRestore();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: realFetch,
    });
  }
}

function richSession(): CanonicalTurn[] {
  const turns: CanonicalTurn[] = [userMessage(0, "Fix the login redirect.")];
  for (let index = 1; index < 40; index += 1) {
    if (index % 9 === 0) {
      turns.push(summaryTurn(index, `Summary at ${index}. ${"s".repeat(200)}`));
    } else if (index % 5 === 0) {
      turns.push(toolTurn(index, "Edit", `'src/file-${index}.ts'`, "1 hunk", "mutating"));
    } else if (index % 2 === 0) {
      turns.push(toolTurn(index, "Read", `'src/file-${index}.ts'`, `${index} lines`));
    } else {
      turns.push(agentMessage(index, `Answer at ${index}. ${"a".repeat(200)}`));
    }
  }
  return turns;
}

describe("T-TRA-27 no input or output", () => {
  test("the seal really does throw", () => {
    sealed(() => {
      expect(() => Date.now()).toThrow(/clock/);
      expect(() => Math.random()).toThrow(/randomness/);
      expect(() => globalThis.fetch("https://example.invalid")).toThrow(/network/);
    });
    expect(typeof Date.now()).toBe("number");
  });

  test("a plan is produced with no clock, no filesystem and no network", () => {
    const plan = sealed(() =>
      rules.apply(sessionOf(richSession()), targetOf(200_000), configOf(0.3, 5), charEstimator),
    );

    expect(plan.blockedReason).toBeNull();
    expect(plan.keptTurnCount).toBe(40);
  });

  test("the tight, the blocked, the broken and the empty cases all work", () => {
    const plans = sealed(() => ({
      tight: rules.apply(sessionOf(richSession()), targetOf(3000), configOf(1, 5), charEstimator),
      blocked: rules.apply(
        sessionOf([userMessage(0, "x".repeat(5000))]),
        targetOf(1000),
        configOf(1, 5),
        charEstimator,
      ),
      broken: rules.apply(
        sessionOf([userMessage(0, "Go."), brokenToolTurn(1, "Edit", "'a.ts'")]),
        targetOf(200_000),
        configOf(0.3, 5),
        charEstimator,
      ),
      empty: rules.apply(sessionOf([]), targetOf(200_000), configOf(0.3, 5), charEstimator),
    }));

    expect(plans.tight.estimatedTokens).toBeLessThanOrEqual(plans.tight.budgetTokens);
    expect(plans.blocked.blockedReason).not.toBeNull();
    expect(plans.broken.brokenTailDropped).toBe(true);
    expect(plans.empty.blockedReason).not.toBeNull();
    expect(plans.empty.turns).toEqual([]);
  });

  test("repeated sealed calls still agree with each other", () => {
    const session = sessionOf(richSession());
    const runs = sealed(() =>
      Array.from({ length: 10 }, () =>
        rules.apply(session, targetOf(3000), configOf(1, 5), charEstimator),
      ),
    );

    for (const plan of runs) {
      expect(plan).toEqual(runs[0]);
    }
  });
});
