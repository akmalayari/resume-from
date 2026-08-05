// Test support for this module's tests. Every git repository built here is disposable and lives in
// a temporary directory: nothing in these helpers may run against the repository of this project.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Hermetic: the user's global and system git configuration must not reach a test repository.
// A global `commit.gpgsign`, `core.hooksPath` or `init.templateDir` would otherwise change what
// these repositories contain, and T-REP-12 compares a repository against itself byte for byte.
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Resume From Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Resume From Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_AUTHOR_DATE: "2024-01-01T00:00:00+00:00",
  GIT_COMMITTER_DATE: "2024-01-01T00:00:00+00:00",
};

const createdDirs: string[] = [];

/** A fresh temporary directory, fully resolved so path comparisons are not symlink comparisons. */
export async function tempDir(prefix = "resume-from-repo-"): Promise<string> {
  const base = await realpath(tmpdir());
  const dir = await mkdtemp(join(base, prefix));
  createdDirs.push(dir);
  return dir;
}

/** Removes every directory this helper created. Call from `afterAll`. */
export async function cleanupTempDirs(): Promise<void> {
  const dirs = createdDirs.splice(0, createdDirs.length);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

export async function git(dir: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args], { env: GIT_ENV });
  return stdout.trim();
}

/** A repository with no commits, on branch `main`. */
export async function initRepo(prefix?: string): Promise<string> {
  const dir = await tempDir(prefix);
  await git(dir, ["init", "-b", "main", "--quiet"]);
  return dir;
}

/**
 * Writes `${name}.txt`, commits it with `name` as the message, and returns the new commit.
 * The content carries the repository path so two unrelated repositories never produce the same
 * commit — the dates and the author are fixed, so identical content would collide.
 */
export async function commitFile(dir: string, name: string): Promise<string> {
  await writeFile(join(dir, `${name}.txt`), `${name} in ${dir}\n`);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", name, "--quiet"]);
  return headOf(dir);
}

/** `count` commits in order; returns their commits, oldest first. */
export async function commitSeries(dir: string, count: number, prefix = "c"): Promise<string[]> {
  const commits: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    commits.push(await commitFile(dir, `${prefix}${i}`));
  }
  return commits;
}

/** A repository with one commit on `main`. */
export async function repoWithOneCommit(prefix?: string): Promise<{ dir: string; head: string }> {
  const dir = await initRepo(prefix);
  const head = await commitFile(dir, "first");
  return { dir, head };
}

export async function headOf(dir: string): Promise<string> {
  return git(dir, ["rev-parse", "HEAD"]);
}

export async function makeDir(...segments: string[]): Promise<string> {
  const dir = join(...segments);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Every file, directory and symlink under `dir`, each with a content hash, sorted.
 * An array rather than one digest so a failure names the file that changed.
 */
export async function checksumTree(dir: string): Promise<string[]> {
  const entries: string[] = [];
  await walk(dir, dir, entries);
  return entries.sort();
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full);
    if (entry.isSymbolicLink()) {
      out.push(`l ${rel} -> ${await readlink(full)}`);
    } else if (entry.isDirectory()) {
      out.push(`d ${rel}`);
      await walk(root, full, out);
    } else {
      const hash = createHash("sha256")
        .update(await readFile(full))
        .digest("hex");
      out.push(`f ${rel} ${hash}`);
    }
  }
}
