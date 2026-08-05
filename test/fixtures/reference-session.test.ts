/**
 * Guards the shared fixture itself. `src/session/` owns the vocabulary invariants and
 * asserts them in full (T-SES-3 to T-SES-8); this file only checks that the fixture is
 * present and shaped, so a broken fixture fails here rather than in fourteen tasks at once.
 */

import { describe, expect, it } from "vitest";
import { REFERENCE_SESSION } from "./reference-session.js";

describe("reference session fixture", () => {
  it("covers every turn kind the tree needs (T-SES-8)", () => {
    const turns = REFERENCE_SESSION.turns;
    expect(turns.some((t) => t.role === "user" && t.kind === "message")).toBe(true);
    expect(turns.some((t) => t.role === "agent" && t.kind === "message")).toBe(true);
    expect(turns.some((t) => t.kind === "summary")).toBe(true);
    expect(turns.some((t) => t.toolCall?.effect === "read-only")).toBe(true);
    expect(turns.some((t) => t.toolCall?.effect === "mutating")).toBe(true);
    expect(turns.some((t) => t.toolCall?.bodyDropped === true)).toBe(true);
  });

  it("indexes the turns in source order with no gaps (T-SES-6)", () => {
    REFERENCE_SESSION.turns.forEach((turn, position) => {
      expect(turn.index).toBe(position);
    });
  });
});
