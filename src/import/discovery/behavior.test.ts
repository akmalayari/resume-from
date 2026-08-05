// T-DIS-21 to T-DIS-23 — what the user sees: everything from disk, every agent, every profile.

import { rm } from "node:fs/promises";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { HomeEntry, SearchScope } from "./contract.js";
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
let network: ReturnType<typeof stubNetwork>;
const homeEnv = process.env.HOME;

beforeAll(() => {
  network = stubNetwork();
});

beforeEach(async () => {
  root = await makeFixtureRoot();
  repoA = await makeDir(root, "repo-a");
});

afterEach(async () => {
  if (homeEnv === undefined) delete process.env.HOME;
  else process.env.HOME = homeEnv;
  await rm(root, { recursive: true, force: true });
});

function scopeFor(repoRoot: string): SearchScope {
  return { repoRoot, onlyAgent: null, onlyHome: null };
}

function finderOf(adapters: StubAdapter[], extraHomes: HomeEntry[] = []) {
  return createSessionFinder({ adapters, config: { extraHomes } });
}

it("T-DIS-21 — the listing works with the source agent stopped", async () => {
  // No agent process, no network: everything comes from the fixture files (FR-8).
  const home = await makeDir(root, "pi-home");
  await writeSession(home, {
    id: "pi-1",
    updatedAt: "2026-07-01T10:00:00.000Z",
    repoPath: repoA,
    turns: [
      { index: 0, role: "user", kind: "message", text: "hi", toolCall: null, timestamp: null },
    ],
  });
  await writeSession(home, { id: "pi-2", updatedAt: "2026-07-02T10:00:00.000Z", repoPath: repoA });
  const finder = finderOf([makeStubAdapter({ agent: "pi", defaultHome: home })]);

  const listing = await finder.list(scopeFor(repoA));
  const chosen = await finder.resolve(scopeFor(repoA), { by: "row", row: 2 });
  const session = await finder.load(chosen);

  expect(listing.rows.map((r) => r.ref.id)).toEqual(["pi-2", "pi-1"]);
  expect(listing.failures).toEqual([]);
  expect(session.turns).toHaveLength(1);
  expect(network).not.toHaveBeenCalled();
});

it("T-DIS-22 — one list, every agent", async () => {
  const piHome = await makeDir(root, "pi-home");
  const codexHome = await makeDir(root, "codex-home");
  const ccHome = await makeDir(root, "cc-home");
  await writeSession(piHome, {
    id: "pi-1",
    updatedAt: "2026-07-03T08:00:00.000Z",
    repoPath: repoA,
  });
  await writeSession(codexHome, {
    id: "cx-1",
    updatedAt: "2026-07-03T09:00:00.000Z",
    repoPath: repoA,
  });
  await writeSession(ccHome, {
    id: "cc-1",
    updatedAt: "2026-07-03T07:00:00.000Z",
    repoPath: repoA,
  });

  // Pi is the target of this run; that changes nothing about which sources are searched.
  const listing = await finderOf([
    makeStubAdapter({ agent: "pi", defaultHome: piHome }),
    makeStubAdapter({ agent: "codex", defaultHome: codexHome }),
    makeStubAdapter({ agent: "claude-code", defaultHome: ccHome }),
  ]).list(scopeFor(repoA));

  expect(listing.rows.map((r) => r.ref.agent)).toEqual(["codex", "pi", "claude-code"]);
  expect(listing.rows.map((r) => r.ref.id)).toEqual(["cx-1", "pi-1", "cc-1"]);
});

it("T-DIS-23 — two profiles of one agent appear together", async () => {
  process.env.HOME = root;
  const main = await makeDir(root, ".claude");
  const team = await makeDir(root, ".claude-team");
  await writeSession(main, {
    id: "main-1",
    updatedAt: "2026-07-04T08:00:00.000Z",
    repoPath: repoA,
  });
  await writeSession(team, {
    id: "team-1",
    updatedAt: "2026-07-04T09:00:00.000Z",
    repoPath: repoA,
  });

  const listing = await finderOf(
    [makeStubAdapter({ agent: "claude-code", defaultHome: "~/.claude" })],
    [{ agent: "claude-code", home: "~/.claude-team" }],
  ).list(scopeFor(repoA));

  expect(listing.rows.map((r) => [r.ref.id, r.ref.home])).toEqual([
    ["team-1", team],
    ["main-1", main],
  ]);
});
