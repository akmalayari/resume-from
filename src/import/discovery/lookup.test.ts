import { realpath, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRepoReader } from "../../platform/repo/index.js";
import { createSessionFinder } from "./finder.js";
import { makeDir, makeFixtureRoot, makeStubAdapter, writeSession } from "./test-support.js";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, realpath: vi.fn(fs.realpath) };
});
let root: string;
let destination: string;
let home: string;
beforeEach(async () => {
  root = await makeFixtureRoot();
  destination = await makeDir(root, "destination");
  home = await makeDir(root, "home");
});
afterEach(async () => {
  vi.mocked(realpath).mockRestore();
  await rm(root, { recursive: true, force: true });
});
const unresolved = { root: null, commonDir: null, isBare: false, head: null, branch: null };

it.each(["EACCES", "EIO"])(
  "shares filesystem %s failures at the session boundary, refreshing on the next listing",
  async (code) => {
    const candidate = await makeDir(root, "candidate");
    for (const id of ["bad-one", "bad-two", "good"]) {
      await writeSession(home, {
        id,
        repoPath: id === "good" ? destination : candidate,
        updatedAt: "2026-01-01",
      });
    }
    const identify = vi.fn(async () => unresolved);
    const discovery = createSessionFinder({
      adapters: [makeStubAdapter({ agent: "pi", defaultHome: home })],
      config: { extraHomes: [] },
      repo: { identify },
    });
    const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const failure = Object.assign(new Error("cannot resolve candidate"), { code });
    vi.mocked(realpath).mockImplementation(async (directory) => {
      if (directory === candidate) throw failure;
      return real.realpath(directory);
    });
    const scope = { repoRoot: destination, onlyAgent: null, onlyHome: null };
    const listing = await discovery.list(scope);
    expect(listing.rows.map((row) => row.ref.id)).toEqual(["good"]);
    expect(listing.failures).toHaveLength(2);
    expect(
      listing.failures.every((entry) => entry.message.includes("cannot resolve candidate")),
    ).toBe(true);
    expect(
      vi.mocked(realpath).mock.calls.filter(([directory]) => directory === candidate),
    ).toHaveLength(1);
    expect(identify).toHaveBeenCalledTimes(1);
    vi.mocked(realpath).mockImplementation(real.realpath);
    expect(
      (await discovery.list(scope)).failures.every((entry) => entry.message.includes("unresolved")),
    ).toBe(true);
    expect(identify).toHaveBeenCalledTimes(3);
    vi.mocked(realpath).mockImplementation(async () => {
      throw failure;
    });
    await expect(discovery.list(scope)).rejects.toThrow(
      "Destination repository lookup failed: cannot resolve candidate",
    );
  },
);

it("shares missing and unresolved candidates, without making missing exact paths positive evidence", async () => {
  const missing = path.join(destination, "missing");
  for (const id of ["one", "two"]) {
    await writeSession(home, {
      id,
      repoPath: missing,
      repoPaths: [missing, destination],
      updatedAt: "2026-01-01",
    });
  }
  const identify = vi.fn(async () => unresolved);
  const discovery = createSessionFinder({
    adapters: [makeStubAdapter({ agent: "pi", defaultHome: home })],
    config: { extraHomes: [] },
    repo: { identify },
  });
  const scope = { repoRoot: destination, onlyAgent: null, onlyHome: null };
  expect((await discovery.list(scope)).rows).toHaveLength(2);
  expect(identify.mock.calls).toHaveLength(2);
  expect((await discovery.list({ ...scope, repoRoot: missing })).rows).toHaveLength(0);
  expect(identify.mock.calls).toHaveLength(4);
});

it.each([undefined, new Error("custom stop"), "stop"])(
  "propagates normalized cancellation even for a missing destination (%s)",
  async (reason) => {
    const controller = new AbortController();
    controller.abort(reason);
    const discovery = createSessionFinder({
      adapters: [],
      config: { extraHomes: [] },
      repo: createRepoReader({ signal: controller.signal }),
    });
    await expect(
      discovery.list({
        repoRoot: path.join(destination, "missing"),
        onlyAgent: null,
        onlyHome: null,
      }),
    ).rejects.toMatchObject({ name: "AbortError", cause: controller.signal.reason });
  },
);
