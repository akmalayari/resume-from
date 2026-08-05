import { describe, expect, it } from "vitest";
import { REFERENCE_SESSION } from "../../../test/fixtures/reference-session.js";
import { createPiAdapter } from "./adapter.js";
import type { SerializedSession, TargetProfile } from "./contract.js";
import { entriesOf, markerFixture } from "./fixtures.js";

const CWD = "/Users/testuser/Workspace/demo";
const TARGET: TargetProfile = {
  agent: "pi",
  home: "/tmp/does-not-need-to-exist",
  windowTokens: 200_000,
};

function adapter() {
  let entry = 0;
  return createPiAdapter({
    cwd: () => CWD,
    now: () => new Date("2026-08-02T10:00:00.000Z"),
    newSessionId: () => "01998877-6655-4433-2211-000000000001",
    newEntryId: () => {
      entry += 1;
      return `e${entry.toString().padStart(7, "0")}`;
    },
  });
}

function serializeReference(): SerializedSession {
  return adapter().serialize(REFERENCE_SESSION, TARGET, markerFixture());
}

/** Rewrite the nth assistant message of a serialized session. */
function withAssistantPatched(
  serialized: SerializedSession,
  nth: number,
  patch: (message: Record<string, unknown>) => void,
): { patched: SerializedSession; lineIndex: number } {
  const file = serialized.files[0];
  if (!file) throw new Error("no file to patch");
  const entries = entriesOf(file.bytes.toString("utf8"));
  let seen = -1;
  let lineIndex = -1;
  for (const [index, entry] of entries.entries()) {
    const message = entry.message as Record<string, unknown> | undefined;
    if (message?.role !== "assistant") continue;
    seen += 1;
    if (seen !== nth) continue;
    patch(message);
    lineIndex = index;
    break;
  }
  if (lineIndex < 0) throw new Error("no assistant message to patch");
  const bytes = Buffer.from(
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
  return {
    patched: { ...serialized, files: [{ absolutePath: file.absolutePath, bytes }] },
    lineIndex,
  };
}

describe("T-PI-6 — validation rejects a missing usage object", () => {
  it("names the offending entry and stops the import before placement", () => {
    const { patched, lineIndex } = withAssistantPatched(serializeReference(), 1, (message) => {
      delete message.usage;
    });

    const defects = adapter().validate(patched);
    expect(defects).toHaveLength(1);
    expect(defects[0]?.path).toContain(String(lineIndex));
    expect(defects[0]?.path).toContain("usage");
    expect(defects[0]?.message).toMatch(/usage/i);
  });

  it("finds a defect in every offending message, not only the first (invariant)", () => {
    const once = withAssistantPatched(serializeReference(), 0, (message) => {
      delete message.usage;
    });
    const twice = withAssistantPatched(once.patched, 1, (message) => {
      delete message.usage;
    });

    expect(adapter().validate(twice.patched)).toHaveLength(2);
  });

  it("accepts the serializer's own output", () => {
    expect(adapter().validate(serializeReference())).toEqual([]);
  });
});

describe("T-PI-7 — validation is not fooled by a partial usage object", () => {
  const cases: [string, unknown][] = [
    ["an empty object", {}],
    ["a null input", { input: null, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }],
    [
      "a string where a number belongs",
      {
        input: "1200",
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    ],
    ["a missing cost object", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }],
    [
      "a cost object without a numeric total",
      {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: null },
      },
    ],
    ["null instead of an object", null],
    ["an array instead of an object", []],
  ];

  it.each(cases)("rejects %s", (_name, usage) => {
    const { patched } = withAssistantPatched(serializeReference(), 0, (message) => {
      message.usage = usage;
    });

    const defects = adapter().validate(patched);
    expect(defects.length).toBeGreaterThan(0);
    expect(defects[0]?.path).toContain("usage");
  });

  it("accepts zeros, which is what an imported turn honestly spent", () => {
    const { patched } = withAssistantPatched(serializeReference(), 0, (message) => {
      message.usage = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      };
    });

    expect(adapter().validate(patched)).toEqual([]);
  });
});

describe("validation guards the rest of the file shape (FR-50)", () => {
  it("rejects a file that does not start with a session header", () => {
    const serialized = serializeReference();
    const file = serialized.files[0];
    if (!file) throw new Error("no file");
    const entries = entriesOf(file.bytes.toString("utf8")).slice(1);
    const bytes = Buffer.from(`${entries.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");

    const defects = adapter().validate({ ...serialized, files: [{ ...file, bytes }] });
    expect(defects.length).toBeGreaterThan(0);
  });

  it("rejects an unparsable line", () => {
    const serialized = serializeReference();
    const file = serialized.files[0];
    if (!file) throw new Error("no file");
    const bytes = Buffer.from(`${file.bytes.toString("utf8")}{"type":"message"\n`, "utf8");

    const defects = adapter().validate({ ...serialized, files: [{ ...file, bytes }] });
    expect(defects.length).toBeGreaterThan(0);
  });

  it("rejects a session id that does not match the header", () => {
    const serialized = serializeReference();
    const defects = adapter().validate({ ...serialized, sessionId: "someone-elses-id" });
    expect(defects.length).toBeGreaterThan(0);
  });

  it("rejects an item count that does not match the file", () => {
    const serialized = serializeReference();
    const defects = adapter().validate({ ...serialized, itemCount: serialized.itemCount + 1 });
    expect(defects.length).toBeGreaterThan(0);
  });
});
