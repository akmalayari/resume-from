import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { CommitDistance, RepoIdentity, RepoReader } from "./contract.js";
import { runGit } from "./git.js";

/** Nothing is known: `ahead` and `behind` are 0 so a caller cannot print a fabricated distance. */
function unknownDistance(): CommitDistance {
  return { known: false, ahead: 0, behind: 0 };
}

function noRepository(): RepoIdentity {
  return { root: null, head: null, branch: null };
}

/**
 * Longer than any revision git can resolve: a full commit is 40 characters, a tag or a ref
 * expression a few more. A longer string is a mistake or an attack, and is not sent to git.
 */
const MAX_REVISION_LENGTH = 256;

/**
 * A reader bound to one working directory.
 *
 * `identify` takes the directory to look at; `distanceFrom` compares against the HEAD of `cwd`,
 * which is the repository the command is running in.
 */
export function createRepoReader(cwd: string = process.cwd()): RepoReader {
  return {
    identify: (directory: string) => identify(directory),
    distanceFrom: (sourceCommit: string) => distanceFrom(cwd, sourceCommit),
  };
}

async function identify(directory: string): Promise<RepoIdentity> {
  const dir = resolve(directory);
  const toplevel = await runGit(dir, ["rev-parse", "--show-toplevel"]);
  if (!toplevel.ok) return noRepository();

  const root = await resolveFully(toplevel.stdout.trim());
  if (root === null) return noRepository();

  return { root, head: await commitOf(dir, "HEAD"), branch: await branch(dir) };
}

async function distanceFrom(cwd: string, sourceCommit: string): Promise<CommitDistance> {
  const revision = plausibleRevision(sourceCommit);
  if (revision === null) return unknownDistance();

  const dir = resolve(cwd);
  const source = await commitOf(dir, revision);
  if (source === null) return unknownDistance();

  const from = await commitOf(dir, "HEAD");
  if (from === null) return unknownDistance();

  // Both sides are commits git itself printed, so the range holds no caller input.
  const counts = await runGit(dir, [
    "rev-list",
    "--left-right",
    "--count",
    `${from}...${source}`,
    "--",
  ]);
  if (!counts.ok) return unknownDistance();

  const parts = counts.stdout.trim().split(/\s+/);
  if (parts.length !== 2) return unknownDistance();
  const ahead = Number(parts[0]);
  const behind = Number(parts[1]);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) return unknownDistance();

  return { known: true, ahead, behind };
}

/** The commit a revision names, or null when this repository does not have it. */
async function commitOf(dir: string, revision: string): Promise<string | null> {
  // `--end-of-options` stops git reading the revision as an option, and `^{commit}` rejects a
  // revision that exists but is not a commit.
  const result = await runGit(dir, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${revision}^{commit}`,
  ]);
  const commit = result.stdout.trim();
  return result.ok && commit !== "" ? commit : null;
}

/** The branch HEAD is on, or null when HEAD is detached. An unborn branch still has a name. */
async function branch(dir: string): Promise<string | null> {
  const result = await runGit(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const name = result.stdout.trim();
  return result.ok && name !== "" ? name : null;
}

/**
 * A revision worth sending to git, trimmed, or null.
 *
 * A string that starts with `-` would be read as an option, an empty one names nothing, and a
 * control character or an absurd length is never a revision. Rejecting them here means the hostile
 * cases of T-REP-11 never reach a process at all.
 */
function plausibleRevision(sourceCommit: string): string | null {
  if (typeof sourceCommit !== "string") return null;
  const revision = sourceCommit.trim();
  if (revision === "" || revision.length > MAX_REVISION_LENGTH) return null;
  if (revision.startsWith("-")) return null;
  if (hasControlCharacter(revision)) return null;
  return revision;
}

/** A NUL cannot be passed to a process at all, and no control character belongs in a revision. */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** The real path of a directory, following symlinks, so paths compare as locations. */
async function resolveFully(directory: string): Promise<string | null> {
  try {
    return await realpath(directory);
  } catch {
    return null;
  }
}
