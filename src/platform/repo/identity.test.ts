import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, expect, test, vi } from "vitest";
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
afterEach(() => vi.unstubAllEnvs());

// Sequential real-Git identity checks need extra test time under full-suite contention.
test("nested, sibling and external worktrees share identity, not checkout roots", async () => {
  const parent = await tempDir();
  const main = await makeDir(parent, "main checkout");
  await git(main, ["init", "-b", "main", "--quiet"]);
  const head = await commitFile(main, "first");
  const external = await tempDir();
  const roots = [
    main,
    join(main, ".worktrees", "nested tree"),
    join(parent, "sibling tree"),
    join(external, "external tree"),
  ];
  for (const root of roots.slice(1)) {
    await git(main, ["worktree", "add", "--detach", root, "HEAD"]);
  }
  const reader = createRepoReader();
  for (const root of roots) {
    const subdir = await makeDir(root, "source or destination", "nested");
    const alias = join(await tempDir(), "symlink alias");
    await symlink(root, alias);
    for (const cwd of [root, subdir, alias, join(alias, "source or destination", "nested")]) {
      expect(await reader.identify(cwd)).toEqual({
        root,
        commonDir: join(main, ".git"),
        isBare: false,
        head,
        branch: root === main ? "main" : null,
      });
    }
  }
}, 30_000);

test("Git path output preserves trailing whitespace in checkout and metadata paths", async () => {
  const parent = await tempDir();
  const root = await makeDir(parent, "checkout ");
  const metadata = join(parent, "metadata ");
  await git(root, ["init", "-b", "main", "--separate-git-dir", metadata]);
  expect(await createRepoReader().identify(root)).toEqual({
    root,
    commonDir: metadata,
    isBare: false,
    head: null,
    branch: "main",
  });
});

test("unborn HEAD still supplies a common directory and branch", async () => {
  const root = await initRepo();
  expect(await createRepoReader().identify(root)).toEqual({
    root,
    commonDir: join(root, ".git"),
    isBare: false,
    head: null,
    branch: "main",
  });
});

test("separate Git directories and their symlink aliases use metadata identity", async () => {
  const parent = await tempDir();
  const root = await makeDir(parent, "checkout");
  const metadata = join(parent, "separate metadata");
  const alias = join(parent, "metadata alias");
  await git(root, ["init", "-b", "main", "--separate-git-dir", metadata]);
  await symlink(metadata, alias);
  // Git follows the alias in the gitfile; identity must resolve it too.
  await writeFile(join(root, ".git"), `gitdir: ${alias}\n`);
  expect(await createRepoReader().identify(root)).toEqual({
    root,
    commonDir: metadata,
    isBare: false,
    head: null,
    branch: "main",
  });
});

test("bare repositories are recognized separately from their linked working trees", async () => {
  const { dir, head } = await repoWithOneCommit();
  const parent = await tempDir();
  const bare = join(parent, "bare.git");
  const worktree = join(parent, "working tree");
  await git(parent, ["clone", "--bare", dir, bare]);
  await git(bare, ["worktree", "add", "--detach", worktree, "HEAD"]);
  const reader = createRepoReader();
  expect(await reader.identify(bare)).toEqual({
    root: null,
    commonDir: bare,
    isBare: true,
    head,
    branch: "main",
  });
  expect(await reader.identify(worktree)).toEqual({
    root: worktree,
    commonDir: bare,
    isBare: false,
    head,
    branch: null,
  });
});

test("nested independent repositories, submodules and clones remain distinct", async () => {
  const { dir } = await repoWithOneCommit();
  const independent = await makeDir(dir, "independent");
  await git(independent, ["init", "-b", "main"]);
  const origin = await repoWithOneCommit();
  await git(dir, ["-c", "protocol.file.allow=always", "submodule", "add", origin.dir, "submodule"]);
  const parent = await tempDir();
  const cloneA = join(parent, "clone a");
  const cloneB = join(parent, "clone b");
  const shared = join(parent, "shared clone");
  await git(parent, ["clone", origin.dir, cloneA]);
  await git(parent, ["clone", origin.dir, cloneB]);
  await git(parent, ["clone", "--shared", origin.dir, shared]);
  const reader = createRepoReader();
  const roots = [dir, independent, join(dir, "submodule"), origin.dir, cloneA, cloneB, shared];
  const identities = await Promise.all(
    roots.map(async (root) => {
      const identity = await reader.identify(await makeDir(root, "nested"));
      expect(identity.root).toBe(root);
      expect(identity.commonDir).not.toBeNull();
      return identity.commonDir;
    }),
  );
  expect(new Set(identities).size).toBe(roots.length);
});

test("missing directories inside a repository do not inherit parent identity", async () => {
  const { dir } = await repoWithOneCommit();
  expect(await createRepoReader().identify(join(dir, "removed", "nested"))).toEqual({
    root: null,
    commonDir: null,
    isBare: false,
    head: null,
    branch: null,
  });
});

test.each(["GIT_COMMON_DIR", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])(
  "inherited %s cannot redirect identity",
  async (variable) => {
    const here = await repoWithOneCommit();
    const elsewhere = await repoWithOneCommit();
    const value =
      variable === "GIT_WORK_TREE"
        ? elsewhere.dir
        : variable === "GIT_INDEX_FILE"
          ? join(elsewhere.dir, ".git", "index")
          : join(elsewhere.dir, ".git");
    vi.stubEnv(variable, value);
    expect(await createRepoReader().identify(here.dir)).toEqual({
      root: here.dir,
      commonDir: join(here.dir, ".git"),
      isBare: false,
      head: here.head,
      branch: "main",
    });
  },
);
