import { afterEach, expect, test, vi } from "vitest";
import { createRepoReader } from "../platform/repo/index.js";
import { createImportPipeline } from "./index.js";
import { createPipelineFromStages } from "./pipeline.js";
import {
  checksumTree,
  createStaticRepoReader,
  createWorld,
  recordingStages,
  referenceSpec,
  type World,
  worldDeps,
  writeSession,
} from "./test-support.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let world: World;
afterEach(async () => world?.cleanup());

test.each([null, "/metadata"])(
  "destination identity %s is resolved once per request and refreshed next request",
  async (commonDir) => {
    world = await createWorld();
    const spec = referenceSpec({ repoPath: world.repoRoot });
    await writeSession(world.homeOf("codex"), spec);
    const repo = createStaticRepoReader({
      identity: { root: world.repoRoot, commonDir, isBare: false, head: null, branch: null },
    });
    const identify = vi.spyOn(repo, "identify");
    const pipeline = createImportPipeline(worldDeps(world, { repo }));
    const request = {
      destinationCwd: world.repoRoot,
      target: world.targetFor("pi"),
      selection: { by: "session-id" as const, id: spec.id },
      onlyAgent: null,
      onlyHome: null,
    };
    await pipeline.list(request);
    expect(identify).toHaveBeenCalledTimes(1);
    await pipeline.list(request);
    expect(identify).toHaveBeenCalledTimes(2);
    const preview = await pipeline.preview(request);
    expect(identify).toHaveBeenCalledTimes(3);
    await pipeline.commit(request, null, preview.confirmationToken);
    expect(identify).toHaveBeenCalledTimes(4);
  },
);

test("aborting while commit enumerates cached destination sessions prevents loading and writing", async () => {
  world = await createWorld();
  const spec = referenceSpec({ repoPath: world.repoRoot });
  await writeSession(world.homeOf("codex"), spec);
  const controller = new AbortController();
  const pipeline = createImportPipeline(
    worldDeps(world, { repo: createRepoReader({ signal: controller.signal }) }),
  );
  const request = {
    destinationCwd: world.repoRoot,
    target: world.targetFor("pi"),
    selection: { by: "session-id" as const, id: spec.id },
    onlyAgent: "codex" as const,
    onlyHome: null,
  };
  const preview = await pipeline.preview(request);
  const adapter = world.adapterOf("codex");
  const found = await adapter.listSessions(world.homeOf("codex"));
  const entered = deferred<void>();
  const pending = deferred<typeof found>();
  adapter.listSessions = () => {
    entered.resolve();
    return pending.promise;
  };
  world.calls.length = 0;
  const result = pipeline.commit(request, null, preview.confirmationToken);
  await entered.promise;
  controller.abort("stop commit");
  pending.resolve(found);
  await expect(result).rejects.toMatchObject({
    stage: "discovery",
    cause: { name: "AbortError", cause: "stop commit" },
  });
  expect(world.calls).not.toContain("codex.loadSession");
  expect(world.calls).not.toContain("pi.serialize");
  expect(await checksumTree(world.targetHomeOf("pi"))).toEqual({});
});

test("bare destinations are refused before any import is created", async () => {
  world = await createWorld();
  const spec = referenceSpec({ repoPath: world.repoRoot });
  await writeSession(world.homeOf("codex"), spec);
  const pipeline = createImportPipeline(
    worldDeps(world, {
      repo: {
        checkCancellation() {},
        identify: async () => ({
          root: null,
          commonDir: world.repoRoot,
          isBare: true,
          head: null,
          branch: null,
        }),
        distanceFrom: async () => ({ known: false, ahead: 0, behind: 0 }),
      },
    }),
  );
  const request = {
    destinationCwd: world.repoRoot,
    target: world.targetFor("pi"),
    selection: { by: "session-id" as const, id: spec.id },
    onlyAgent: null,
    onlyHome: null,
  };
  await expect(pipeline.preview(request)).rejects.toThrow(/bare.*linked worktree/i);
  expect(await checksumTree(world.targetHomeOf("pi"))).toEqual({});
});

test.each(["canonicalCwd", "commonDir"] as const)(
  "confirmation binds fresh %s independently of preview text",
  async (changed) => {
    let canonicalCwd = "/destination";
    let commonDir = "/metadata";
    const recorded = recordingStages({
      destinationFor: async (cwd) => ({
        cwd,
        canonicalCwd,
        identity: {
          root: "/checkout",
          commonDir,
          isBare: false,
          head: "same-head",
          branch: "same-branch",
        },
      }),
    });
    const pipeline = createPipelineFromStages(recorded.stages);
    const request = {
      destinationCwd: "/native-alias/subdir",
      target: { agent: "pi" as const, home: "/target", windowTokens: 200_000 },
      selection: { by: "row" as const, row: 1 },
      onlyAgent: null,
      onlyHome: null,
    };
    const report = await pipeline.preview(request);
    if (changed === "canonicalCwd") canonicalCwd = "/other-destination";
    else commonDir = "/other-metadata";
    expect((await pipeline.preview(request)).lines).toEqual(report.lines);
    await expect(pipeline.commit(request, null, report.confirmationToken)).rejects.toMatchObject({
      stage: "confirmation",
    });
    expect(recorded.landed).toEqual([]);
  },
);

test("destination operational failure stops every operation before serialization", async () => {
  world = await createWorld();
  const spec = referenceSpec({ repoPath: world.repoRoot });
  await writeSession(world.homeOf("codex"), spec);
  const pipeline = createImportPipeline(
    worldDeps(world, {
      repo: {
        checkCancellation() {},
        identify: async () => {
          throw new Error("git could not run: spawn EACCES");
        },
        distanceFrom: async () => ({ known: false, ahead: 0, behind: 0 }),
      },
    }),
  );
  const request = {
    destinationCwd: world.repoRoot,
    target: world.targetFor("pi"),
    selection: { by: "session-id" as const, id: spec.id },
    onlyAgent: null,
    onlyHome: null,
  };
  await expect(pipeline.list(request)).rejects.toThrow(/destination.*EACCES/);
  await expect(pipeline.preview(request)).rejects.toThrow(/destination.*EACCES/);
  await expect(pipeline.commit(request, null, "unused")).rejects.toThrow(/destination.*EACCES/);
  expect(world.calls).not.toContain("pi.serialize");
  expect(await checksumTree(world.targetHomeOf("pi"))).toEqual({});
});

test.each([
  "git could not run: spawn EACCES",
  "git command timed out after 10 ms",
  "git command aborted",
])("commit recomputation stops before landing when distance fails: %s", async (message) => {
  world = await createWorld();
  const spec = referenceSpec({ repoPath: world.repoRoot });
  await writeSession(world.homeOf("codex"), spec);
  let failure: Error | null = null;
  let lookups = 0;
  const pipeline = createImportPipeline(
    worldDeps(world, {
      repo: {
        checkCancellation() {},
        identify: async (cwd) => ({
          root: cwd,
          commonDir: "/metadata",
          isBare: false,
          head: "different-head",
          branch: "main",
        }),
        distanceFrom: async (cwd) => {
          expect(cwd).toBe(world.repoRoot);
          lookups += 1;
          if (failure) throw failure;
          return { known: true, ahead: 1, behind: 0 };
        },
      },
    }),
  );
  const request = {
    destinationCwd: world.repoRoot,
    target: world.targetFor("pi"),
    selection: { by: "session-id" as const, id: spec.id },
    onlyAgent: null,
    onlyHome: null,
  };
  const preview = await pipeline.preview(request);
  failure = new Error(message);
  await expect(pipeline.commit(request, null, preview.confirmationToken)).rejects.toMatchObject({
    stage: "preview",
    cause: failure,
  });
  expect(lookups).toBe(2);
  expect(world.calls).not.toContain("pi.serialize");
  expect(await checksumTree(world.targetHomeOf("pi"))).toEqual({});
});
