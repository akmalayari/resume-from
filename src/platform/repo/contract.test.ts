// T-REP-8 .. T-REP-10 — Integration Contract Tests of src/platform/repo/module.md.

import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { createRepoReader } from "./index.js";
import {
  cleanupTempDirs,
  commitFile,
  git,
  initRepo,
  makeDir,
  repoWithOneCommit,
  tempDir,
} from "./test-support.js";

afterAll(cleanupTempDirs);

const ABSENT_COMMIT = "1234567890abcdef1234567890abcdef12345678";

test("T-REP-8 — an unknown revision is reported, not thrown", async () => {
  const { dir } = await repoWithOneCommit();

  const distance = await createRepoReader(dir).distanceFrom(ABSENT_COMMIT);

  expect(distance).toEqual({ known: false, ahead: 0, behind: 0 });
});

test("T-REP-9 — `known: false` implies zero counts", async () => {
  const repo = (await repoWithOneCommit()).dir;
  const plain = await tempDir("resume-from-plain-");
  const empty = await initRepo();
  const foreignHead = (await repoWithOneCommit("resume-from-foreign-")).head;

  const cases = [
    { name: "an absent commit", cwd: repo, revision: ABSENT_COMMIT },
    { name: "a commit of another repository", cwd: repo, revision: foreignHead },
    { name: "a malformed revision", cwd: repo, revision: "not a revision" },
    { name: "an empty revision", cwd: repo, revision: "" },
    { name: "outside a repository", cwd: plain, revision: foreignHead },
    { name: "a repository with no commits", cwd: empty, revision: foreignHead },
  ];

  for (const { name, cwd, revision } of cases) {
    const distance = await createRepoReader(cwd).distanceFrom(revision);
    expect(distance, name).toEqual({ known: false, ahead: 0, behind: 0 });
  }
});

test("T-REP-10 — the root is fully resolved", async () => {
  // `parent` is already a resolved path, so `real` is the repository's real location and `link`
  // is a second spelling of it.
  const parent = await tempDir("resume-from-symlink-");
  const real = await makeDir(parent, "real");
  const link = join(parent, "link");
  await symlink(real, link);
  await git(real, ["init", "-b", "main", "--quiet"]);
  await commitFile(real, "first");
  await makeDir(real, "nested");

  const reader = createRepoReader(link);

  expect((await reader.identify(link)).root).toBe(real);
  expect((await reader.identify(join(link, "nested"))).root).toBe(real);
});
