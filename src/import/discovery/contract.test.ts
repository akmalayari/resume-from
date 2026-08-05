// T-DIS-10 to T-DIS-13 — selection resolves against the ordering list() produced.

import { rm } from "node:fs/promises";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { CanonicalSession, HomeEntry, SearchScope, SessionFinder } from "./contract.js";
import { createSessionFinder } from "./finder.js";
import {
  makeDir,
  makeFixtureRoot,
  makeStubAdapter,
  type StubAdapter,
  stubNetwork,
  writeSession,
} from "./test-support.js";

let root: string;
let repoA: string;
let piHome: string;
let codexHome: string;

beforeAll(() => {
  stubNetwork();
});

beforeEach(async () => {
  root = await makeFixtureRoot();
  repoA = await makeDir(root, "repo-a");
  piHome = await makeDir(root, "pi-home");
  codexHome = await makeDir(root, "codex-home");
  const plan: Array<[string, string, number]> = [
    [piHome, "pi-1", 1],
    [piHome, "pi-2", 4],
    [codexHome, "cx-1", 2],
    [codexHome, "cx-2", 5],
    [codexHome, "cx-3", 3],
  ];
  for (const [home, id, day] of plan) {
    await writeSession(home, { id, updatedAt: `2026-05-0${day}T08:00:00.000Z`, repoPath: repoA });
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const scope: () => SearchScope = () => ({ repoRoot: repoA, onlyAgent: null, onlyHome: null });

function build(extraHomes: HomeEntry[] = []): { finder: SessionFinder; adapters: StubAdapter[] } {
  const adapters = [
    makeStubAdapter({ agent: "pi", defaultHome: piHome }),
    makeStubAdapter({ agent: "codex", defaultHome: codexHome }),
  ];
  return { finder: createSessionFinder({ adapters, config: { extraHomes } }), adapters };
}

it("T-DIS-10 — every selection form resolves to the same session", async () => {
  const { finder } = build();
  const listing = await finder.list(scope());
  const third = listing.rows[2];
  if (!third) throw new Error("fixture must produce at least three rows");

  const byRow = await finder.resolve(scope(), { by: "row", row: 3 });
  const byId = await finder.resolve(scope(), { by: "session-id", id: third.ref.id });
  const byPath = await finder.resolve(scope(), { by: "file-path", path: third.filePath });

  expect(byRow).toEqual(third);
  expect(byId).toEqual(third);
  expect(byPath).toEqual(third);
});

it("T-DIS-11 — rows are 1-based and match what was listed", async () => {
  const { finder } = build();
  const listing = await finder.list(scope());
  expect(listing.rows).toHaveLength(5);

  for (let row = 1; row <= listing.rows.length; row++) {
    const resolved = await finder.resolve(scope(), { by: "row", row });
    expect(resolved).toEqual(listing.rows[row - 1]);
  }

  await expect(finder.resolve(scope(), { by: "row", row: 0 })).rejects.toMatchObject({
    input: "0",
  });
});

it("T-DIS-12 — resolve after a re-listing agrees", async () => {
  const first = build().finder;
  const listing = await first.list(scope());

  const second = build().finder;
  const resolved = await second.resolve(scope(), { by: "row", row: 3 });

  expect(resolved).toEqual(listing.rows[2]);
});

it("T-DIS-13 — load returns exactly what the adapter produced", async () => {
  const canned: CanonicalSession = {
    provenance: {
      ref: { agent: "pi", home: piHome, id: "pi-2" },
      title: "known session",
      startedAt: "2026-05-04T08:00:00.000Z",
      updatedAt: "2026-05-04T08:00:00.000Z",
      repo: { commit: "abc123", branch: "main", changedPaths: ["src/a.ts"] },
    },
    turns: [
      { index: 0, role: "user", kind: "message", text: "hello", toolCall: null, timestamp: null },
      {
        index: 1,
        role: "agent",
        kind: "tool-call",
        text: "",
        toolCall: {
          toolName: "Read",
          argumentsText: '{"path":"src/a.ts"}',
          outcomeLine: "read 12 lines",
          effect: "read-only",
          bodyDropped: true,
        },
        timestamp: "2026-05-04T08:00:01.000Z",
      },
    ],
  };
  const adapters = [
    makeStubAdapter({ agent: "pi", defaultHome: piHome, loadResult: canned }),
    makeStubAdapter({ agent: "codex", defaultHome: codexHome }),
  ];
  const finder = createSessionFinder({ adapters, config: { extraHomes: [] } });
  const descriptor = await finder.resolve(scope(), { by: "session-id", id: "pi-2" });

  const loaded = await finder.load(descriptor);

  expect(loaded).toBe(canned);
  expect(loaded).toEqual(canned);
});
