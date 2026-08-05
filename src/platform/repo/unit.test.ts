// T-REP-1 .. T-REP-7 — Unit Tests of src/platform/repo/module.md.

import { afterAll, describe, expect, test } from "vitest";
import { createRepoReader } from "./index.js";
import {
  cleanupTempDirs,
  commitFile,
  commitSeries,
  git,
  initRepo,
  makeDir,
  repoWithOneCommit,
  tempDir,
} from "./test-support.js";

afterAll(cleanupTempDirs);

describe("identify", () => {
  test("T-REP-1 — a repository is identified", async () => {
    const { dir, head } = await repoWithOneCommit();

    const identity = await createRepoReader(dir).identify(dir);

    expect(identity).toEqual({ root: dir, head, branch: "main" });
  });

  test("T-REP-2 — identification works from a subdirectory", async () => {
    const { dir } = await repoWithOneCommit();
    const nested = await makeDir(dir, "a", "b", "c");

    const identity = await createRepoReader(dir).identify(nested);

    expect(identity.root).toBe(dir);
  });

  test("T-REP-3 — a directory outside a repository", async () => {
    const dir = await tempDir("resume-from-plain-");

    const identity = await createRepoReader(dir).identify(dir);

    expect(identity).toEqual({ root: null, head: null, branch: null });
  });

  test("T-REP-4 — a repository with no commits", async () => {
    const dir = await initRepo();

    const identity = await createRepoReader(dir).identify(dir);

    expect(identity.root).toBe(dir);
    expect(identity.head).toBeNull();
  });
});

describe("distanceFrom", () => {
  test("T-REP-5 — commit distance ahead", async () => {
    const dir = await initRepo();
    const source = await commitFile(dir, "source");
    await commitSeries(dir, 14);

    const distance = await createRepoReader(dir).distanceFrom(source);

    expect(distance).toEqual({ known: true, ahead: 14, behind: 0 });
  });

  // HEAD stays on `main`; the source commit lives on a second branch, so the source can be both
  // ahead of HEAD (behind) and on a diverged line (ahead and behind together).
  const divergences = [
    { name: "behind by 3", onMain: 0, onOther: 3, ahead: 0, behind: 3 },
    { name: "diverged by 2 and 5", onMain: 2, onOther: 5, ahead: 2, behind: 5 },
  ];

  test.each(divergences)(
    "T-REP-6 — commit distance behind and diverged: $name",
    async ({ onMain, onOther, ahead, behind }) => {
      const dir = await initRepo();
      const base = await commitFile(dir, "base");

      await git(dir, ["checkout", "--quiet", "-b", "other", base]);
      await commitSeries(dir, onOther, "other");
      const source = await git(dir, ["rev-parse", "HEAD"]);

      await git(dir, ["checkout", "--quiet", "main"]);
      await commitSeries(dir, onMain, "main");

      const distance = await createRepoReader(dir).distanceFrom(source);

      expect(distance).toEqual({ known: true, ahead, behind });
    },
  );

  test("T-REP-7 — the same commit", async () => {
    const { dir, head } = await repoWithOneCommit();

    const distance = await createRepoReader(dir).distanceFrom(head);

    expect(distance).toEqual({ known: true, ahead: 0, behind: 0 });
  });
});
