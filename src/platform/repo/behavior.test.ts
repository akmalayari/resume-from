// T-REP-15, T-REP-16 — Behavior Tests of src/platform/repo/module.md.

import { afterAll, expect, test } from "vitest";
import { createRepoReader } from "./index.js";
import {
  cleanupTempDirs,
  commitFile,
  commitSeries,
  initRepo,
  repoWithOneCommit,
} from "./test-support.js";

afterAll(cleanupTempDirs);

test("T-REP-15 — the FR-38 scenario end to end", async () => {
  // The session ran here; the tree then moved on by 14 commits. A recorded commit is an
  // abbreviated one, as git prints it.
  const dir = await initRepo();
  const sessionCommit = await commitFile(dir, "session");
  await commitSeries(dir, 14);
  const reader = createRepoReader(dir);

  expect(await reader.distanceFrom(sessionCommit.slice(0, 7))).toEqual({
    known: true,
    ahead: 14,
    behind: 0,
  });
  expect((await reader.identify(dir)).head).not.toBe(sessionCommit);
});

test("T-REP-16 — a session from another repository", async () => {
  const here = await repoWithOneCommit("resume-from-here-");
  const elsewhere = await repoWithOneCommit("resume-from-elsewhere-");

  const distance = await createRepoReader(here.dir).distanceFrom(elsewhere.head);

  expect(distance).toEqual({ known: false, ahead: 0, behind: 0 });
});
