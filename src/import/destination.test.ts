import { afterEach, expect, test } from "vitest";
import { createImportPipeline } from "./index.js";
import { createPipelineFromStages } from "./pipeline.js";
import {
  checksumTree,
  createWorld,
  recordingStages,
  referenceSpec,
  type World,
  worldDeps,
  writeSession,
} from "./test-support.js";

let world: World;
afterEach(async () => world?.cleanup());

test("bare destinations are refused before any import is created", async () => {
  world = await createWorld();
  const spec = referenceSpec({ repoPath: world.repoRoot });
  await writeSession(world.homeOf("codex"), spec);
  const pipeline = createImportPipeline(
    worldDeps(world, {
      repo: {
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
