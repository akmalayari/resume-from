/**
 * T-ADA-9 to T-ADA-12, T-ADA-14, T-ADA-19 and T-ADA-23 — one test body per requirement, run once
 * for every ordered pair of adapters, each agent with itself included.
 *
 * The three real agents give the nine directions of the scope table (FR-4). The invented fourth
 * agent is in the list too, so the same bodies cover every direction it adds — which is the whole
 * point of FR-57: a new agent is a new entry in a list, never a new test.
 *
 * Each direction seeds a throwaway source home with the source adapter's own `serialize`, reads it
 * back through `listSessions` and `loadSession`, writes it with the target adapter, commits through
 * `src/platform/store/`, and reads the committed session back. Source and target always get their
 * own home, including the diagonal cells.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALL_ADAPTERS,
  cleanupHomes,
  type DirectionRun,
  DROPPED_NOTE,
  directionsOf,
  EXCLUDED_STRINGS,
  installNetworkTripwire,
  networkAttempts,
  REFERENCE_SESSION,
  restoreNetwork,
  runDirection,
  SECRET_BODY,
  sessionText,
  TOOL_NAMES,
  TOOL_SESSION,
  visibleTexts,
} from "./test-support.js";

beforeAll(() => {
  installNetworkTripwire();
});
afterAll(async () => {
  restoreNetwork();
  expect(networkAttempts()).toEqual([]);
  await cleanupHomes();
});

const directions = directionsOf(ALL_ADAPTERS).map(
  ({ source, target }) => [`${source.id} → ${target.id}`, source, target] as const,
);

/** Keys the structure of a replayable tool call would use in any of the four formats. */
const CALL_STRUCTURE_KEYS = [
  "tool_use",
  "tool_result",
  "toolUseResult",
  "function_call",
  "function_call_output",
  "toolCall",
  "toolResult",
  "tool_calls",
];

function keysOf(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    found.add(key);
    if (typeof item === "string") found.add(item);
    keysOf(item, found);
  }
}

/** Every key and every string value of a committed file, whatever its shape. */
function documentKeys(text: string): Set<string> {
  const found = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      keysOf(JSON.parse(line), found);
    } catch {
      // Not one JSON object per line: the whole text is one document.
    }
  }
  try {
    keysOf(JSON.parse(text), found);
  } catch {
    // Already covered line by line.
  }
  return found;
}

describe.each(directions)("%s", (_name, source, target) => {
  describe("T-ADA-9 — the round trip preserves what must cross (AC-1)", () => {
    let run: DirectionRun;
    beforeAll(async () => {
      run = await runDirection(source, target, REFERENCE_SESSION);
    });

    it("keeps every user message, agent answer and summary", () => {
      const crossed = run.reloaded.turns.map((item) => item.text).join("\n");
      for (const text of visibleTexts(REFERENCE_SESSION)) {
        expect(crossed).toContain(text);
      }
    });

    it("keeps every tool name of the source session (FR-27)", () => {
      const crossed = run.reloaded.turns.map((item) => item.text).join("\n");
      for (const record of REFERENCE_SESSION.turns) {
        if (record.toolCall === null) continue;
        expect(crossed).toContain(record.toolCall.toolName);
      }
    });

    it("stores what it promised, and the target can open it (FR-51, FR-52)", () => {
      expect(run.facts).toEqual({
        sessionId: run.serialized.sessionId,
        itemCount: run.serialized.itemCount,
        openable: true,
      });
    });

    it("T-ADA-14 — leaves every file of the source home byte-identical (NG-1, AC-4)", () => {
      expect(run.sourceAfter).toEqual(run.sourceBefore);
      expect(run.sourceBefore.size).toBeGreaterThan(0);
    });
  });

  describe("T-ADA-10 / T-ADA-19 — nothing excluded crosses", () => {
    let run: DirectionRun;
    const secrets = [SECRET_BODY, ...EXCLUDED_STRINGS];
    beforeAll(async () => {
      run = await runDirection(source, target, REFERENCE_SESSION, { hide: secrets });
    });

    it("T-ADA-10 — no result body reaches the target (FR-24)", () => {
      expect(sessionText(run.loaded)).not.toContain(SECRET_BODY);
      expect(run.targetText).not.toContain(SECRET_BODY);
      expect(sessionText(run.reloaded)).not.toContain(SECRET_BODY);
    });

    it("T-ADA-19 — no reasoning, prompt, key or telemetry reaches the target (FR-28, NG-7, NG-8)", () => {
      for (const secret of EXCLUDED_STRINGS) {
        expect(sessionText(run.loaded)).not.toContain(secret);
        expect(run.targetText).not.toContain(secret);
        expect(sessionText(run.reloaded)).not.toContain(secret);
      }
      expect(run.targetText).not.toContain("OPENAI_API_KEY");
    });

    it("still carries the session it could read", () => {
      const crossed = run.reloaded.turns.map((item) => item.text).join("\n");
      for (const text of visibleTexts(REFERENCE_SESSION)) expect(crossed).toContain(text);
    });
  });

  describe("T-ADA-11 / T-ADA-12 / T-ADA-23 — tool calls cross as text", () => {
    let run: DirectionRun;
    beforeAll(async () => {
      run = await runDirection(source, target, TOOL_SESSION);
    });

    it("T-ADA-11 — a dropped body keeps its outcome line and its note (FR-23, FR-25)", () => {
      const crossed = run.reloaded.turns.map((item) => item.text).join("\n");
      expect(crossed).toContain("Read('src/auth.ts') → 400 lines");
      expect(crossed).toContain(DROPPED_NOTE);
      expect(run.targetText).toContain(DROPPED_NOTE);
    });

    it("T-ADA-12 — every tool name crosses unchanged, invented ones included (FR-27)", () => {
      for (const name of TOOL_NAMES) expect(run.targetText).toContain(name);
      const crossed = run.reloaded.turns.map((item) => item.text).join("\n");
      for (const name of TOOL_NAMES) expect(crossed).toContain(name);
    });

    it("T-ADA-23 — a mutating call is text, not a call the target could replay (FR-26, NG-6)", () => {
      const keys = documentKeys(run.targetText);
      for (const key of CALL_STRUCTURE_KEYS) expect([...keys]).not.toContain(key);
      const crossed = run.reloaded.turns.map((item) => item.text).join("\n");
      expect(crossed).toContain("Edit('src/auth.ts') → 1 hunk applied");
      // Nothing the target holds asks it to run anything: no arguments structure survives.
      expect(run.reloaded.turns.every((item) => item.toolCall === null)).toBe(true);
    });
  });
});
