// The only place in the system that creates files. It adds files to a target home, never touches a
// file that already exists (FR-49), and either creates all of them or none (FR-53).
//
// Strategy: stage every file under a temporary name in its destination directory, then place them
// all with `link`, which fails rather than overwrites. Staging first is what makes an interrupted
// commit leave no destination file at all; `link` instead of `rename` is what makes the check-then-
// place race fail the commit instead of destroying a file that appeared (C-3).
//
// This file has no runtime import of its own siblings on purpose: the interrupt test loads it in a
// bare Node child process.

import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, link, lstat, mkdir, open, rmdir, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  CommitError,
  CommitHandle,
  CommitRefusal,
  FileCommitter,
  PendingFile,
} from "./contract.js";

/** Leading dot and no session-like suffix: a leftover is a name no agent will read (T-STO-17). */
const TEMPORARY_PREFIX = ".resume-from-";
const TEMPORARY_SUFFIX = ".tmp";

interface Staged {
  temporary: string;
  destination: string;
}

class CommitFailure extends Error implements CommitError {
  readonly refusal: CommitRefusal;
  readonly path: string | null;

  constructor(refusal: CommitRefusal, path: string | null, message: string) {
    super(message);
    this.name = "CommitError";
    this.refusal = refusal;
    this.path = path;
  }
}

/** Creates the guarded store. It holds no state between commits. */
export function createFileCommitter(): FileCommitter {
  return { commit };
}

async function commit(files: PendingFile[]): Promise<CommitHandle> {
  checkPaths(files);
  await checkDestinations(files);

  const createdDirs: string[] = [];
  const createdFiles: string[] = [];
  const staged: Staged[] = [];
  try {
    for (const file of files) {
      await createParents(dirname(file.absolutePath), createdDirs);
      staged.push(await stage(file));
    }
    for (const item of staged) {
      await place(item);
      createdFiles.push(item.destination);
    }
  } catch (error) {
    await discard(staged);
    await removeCreated(createdFiles, createdDirs);
    throw asCommitFailure(error);
  }

  return {
    createdPaths: [...createdFiles],
    rollback: async () => {
      await removeCreated(createdFiles, createdDirs);
    },
  };
}

/** Refuses what no filesystem call could tell us: a relative path, or the same path listed twice. */
function checkPaths(files: PendingFile[]): void {
  const seen = new Set<string>();
  for (const file of files) {
    const path = file.absolutePath;
    if (!isAbsolute(path)) {
      throw new CommitFailure(
        "write-failed",
        path,
        `Refused to write "${path}": the path is not absolute. Pass an absolute path — a relative path is never resolved against the current directory.`,
      );
    }
    const key = resolve(path);
    if (seen.has(key)) {
      throw new CommitFailure(
        "write-failed",
        path,
        `Refused to write "${path}": the same path is listed twice in one commit. Remove the duplicate — this store never overwrites a file, not even one it just created.`,
      );
    }
    seen.add(key);
  }
}

/** Runs before the first byte is written: nothing may exist, and every destination must be reachable. */
async function checkDestinations(files: PendingFile[]): Promise<void> {
  for (const file of files) {
    if (await exists(file.absolutePath)) {
      throw new CommitFailure("path-exists", file.absolutePath, alreadyExists(file.absolutePath));
    }
  }
  const checked = new Set<string>();
  for (const file of files) {
    const parent = dirname(file.absolutePath);
    if (checked.has(parent)) continue;
    checked.add(parent);
    const anchor = await nearestExisting(parent);
    // No ancestor at all, or an ancestor that is not a directory: only the write can say what is
    // wrong there, and it reports it as a failed write.
    if (anchor === null || !anchor.isDirectory) continue;
    try {
      await access(anchor.path, constants.W_OK | constants.X_OK);
    } catch {
      throw new CommitFailure("not-writable", anchor.path, notWritable(anchor.path));
    }
  }
}

/** Writes the bytes under a temporary name in the destination directory. */
async function stage(file: PendingFile): Promise<Staged> {
  const destination = file.absolutePath;
  const temporary = join(
    dirname(destination),
    `${TEMPORARY_PREFIX}${randomBytes(8).toString("hex")}${TEMPORARY_SUFFIX}`,
  );
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(file.bytes);
    } finally {
      await handle.close();
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw new CommitFailure("write-failed", destination, writeFailed(destination, error));
  }
  return { temporary, destination };
}

/** Moves a staged file to its destination. Never overwrites: `link` fails when the path exists. */
async function place({ temporary, destination }: Staged): Promise<void> {
  try {
    await link(temporary, destination);
  } catch (error) {
    if (codeOf(error) === "EEXIST") {
      throw new CommitFailure("path-exists", destination, alreadyExists(destination));
    }
    throw new CommitFailure("write-failed", destination, writeFailed(destination, error));
  }
  await unlink(temporary).catch(() => undefined);
}

/** Creates the missing directories of a chain, recording only the ones this commit created. */
async function createParents(directory: string, createdDirs: string[]): Promise<void> {
  const missing: string[] = [];
  let current = directory;
  while (!(await exists(current))) {
    missing.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const missingDir of missing.reverse()) {
    try {
      await mkdir(missingDir);
      createdDirs.push(missingDir);
    } catch (error) {
      if (codeOf(error) === "EEXIST") continue; // someone else created it; not ours to remove
      throw new CommitFailure("write-failed", missingDir, writeFailed(missingDir, error));
    }
  }
}

/** Removes leftover staged files. Best effort: a leftover must never fail a commit. */
async function discard(staged: Staged[]): Promise<void> {
  for (const item of staged) {
    await unlink(item.temporary).catch(() => undefined);
  }
}

/**
 * Removes exactly what a commit created, deepest first, and nothing else. Every failure is ignored,
 * which is what makes rollback idempotent and safe after a manual deletion.
 */
async function removeCreated(files: string[], directories: string[]): Promise<void> {
  for (const file of files) {
    await unlink(file).catch(() => undefined);
  }
  for (const directory of [...directories].reverse()) {
    await rmdir(directory).catch(() => undefined); // silently keeps a directory that is not empty
  }
}

/** True when the path is taken, symlinks included — a dangling symlink is still a taken path. */
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    const code = codeOf(error);
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw new CommitFailure("not-writable", path, notWritable(dirname(path)));
  }
}

/** The closest ancestor of `directory` that exists, or null at the root. */
async function nearestExisting(
  directory: string,
): Promise<{ path: string; isDirectory: boolean } | null> {
  let current = directory;
  for (;;) {
    const info = await stat(current).catch(() => null);
    if (info !== null) return { path: current, isDirectory: info.isDirectory() };
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function asCommitFailure(error: unknown): CommitError {
  if (error instanceof CommitFailure) return error;
  return new CommitFailure(
    "write-failed",
    null,
    `Failed to write the requested files: ${reasonOf(error)}. Nothing was left behind — every file this commit created was removed. Check the target and the free space, then run the command again.`,
  );
}

function alreadyExists(path: string): string {
  return `Refused to write "${path}": that path already exists. This tool only adds files. Remove or rename the existing file, or choose a different target, then run the command again.`;
}

function notWritable(directory: string): string {
  return `Refused to write into "${directory}": the directory is not writable. Check its permissions, or choose a different target, then run the command again.`;
}

function writeFailed(path: string, cause: unknown): string {
  return `Failed to write "${path}": ${reasonOf(cause)}. Nothing was left behind — every file this commit created was removed. Check the path and the free space, then run the command again.`;
}

function codeOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
