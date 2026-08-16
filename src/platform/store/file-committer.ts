// The only place in the system that creates files. It adds files to a target home, never touches a
// file that already exists (FR-49), and atomically publishes at most one file (FR-53).
//
// Strategy: stage the file under a temporary name in its destination directory, then place it with
// `link`, which fails rather than overwrites. Staging first is what makes an interrupted
// commit leave no destination file at all; `link` instead of `rename` is what makes the check-then-
// place race fail the commit instead of destroying a file that appeared (C-3).
//
// This file has no runtime import of its own siblings on purpose: the interrupt test loads it in a
// bare Node child process.

import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, link, lstat, mkdir, open, realpath, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
  identity: FileIdentity;
}

interface FileIdentity {
  dev: number;
  ino: number;
}

interface OwnedPath extends FileIdentity {
  path: string;
}

class CommitFailure extends Error implements CommitError {
  readonly refusal: CommitRefusal;
  readonly path: string | null;
  readonly remainingPaths?: string[];

  constructor(
    refusal: CommitRefusal,
    path: string | null,
    message: string,
    remainingPaths?: string[],
  ) {
    super(message);
    this.name = "CommitError";
    this.refusal = refusal;
    this.path = path;
    if (remainingPaths !== undefined) this.remainingPaths = remainingPaths;
  }
}

/** Creates the guarded store. It holds no state between commits. */
export function createFileCommitter(): FileCommitter {
  return { commit };
}

async function commit(root: string, files: PendingFile[]): Promise<CommitHandle> {
  checkCardinality(files);
  checkPaths(root, files);
  const createdDirs: OwnedPath[] = [];
  const createdFiles: OwnedPath[] = [];
  const staged: Staged[] = [];
  if (files.length === 0) {
    return { createdPaths: [] };
  }

  let resolvedRoot: string;
  try {
    await createTargetRoot(root, createdDirs);
    await verifyOwnedDirectories(createdDirs);
    resolvedRoot = await checkDestinations(root, files);
    await verifyOwnedDirectories(createdDirs);
  } catch (error) {
    const remainingPaths = [
      ...remainingFrom(error),
      ...createdPathNames(createdFiles, createdDirs),
    ];
    throw asCommitFailure(error, remainingPaths);
  }

  try {
    for (const file of files) {
      await createParents(dirname(file.absolutePath), resolvedRoot, createdDirs);
      await checkResolvedInside(resolvedRoot, dirname(file.absolutePath));
      staged.push(await stage(file, resolvedRoot));
    }
    for (const item of staged) {
      await place(item);
      createdFiles.push({ path: item.destination, ...item.identity });
    }
  } catch (error) {
    const temporaryPaths = await discard(staged);
    const remainingPaths = [
      ...remainingFrom(error),
      ...temporaryPaths,
      ...createdPathNames(createdFiles, createdDirs),
    ];
    throw asCommitFailure(error, remainingPaths);
  }

  const remainingTemporaryPaths = await discard(staged);
  if (remainingTemporaryPaths.length > 0) {
    // Placement succeeded: the published destination is real. Only the temporary staging file(s)
    // could not be removed. Pass them separately so the message is honest about what happened.
    const publishedPaths = createdPathNames(createdFiles, createdDirs);
    throw cleanupFailure(remainingTemporaryPaths, publishedPaths);
  }

  return { createdPaths: createdFiles.map(({ path }) => path) };
}

function checkCardinality(files: PendingFile[]): void {
  if (files.length <= 1) return;
  throw new CommitFailure(
    "write-failed",
    null,
    `Refused to create ${files.length} files in one commit. A session must serialize to one file so placement is atomic across process interruption.`,
  );
}

/** Creates a missing target root as part of this commit and records it for failure reporting. */
async function createTargetRoot(root: string, createdDirs: OwnedPath[]): Promise<void> {
  const missing: string[] = [];
  let current = root;
  while (!(await exists(current))) {
    missing.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const missingDir of missing.reverse()) {
    try {
      await mkdir(missingDir, { mode: 0o700 });
      const info = await lstat(missingDir);
      createdDirs.push({ path: missingDir, dev: info.dev, ino: info.ino });
    } catch (error) {
      if (codeOf(error) === "EEXIST") continue;
      throw new CommitFailure("write-failed", missingDir, writeFailed(missingDir, error));
    }
  }
}

async function verifyOwnedDirectories(directories: OwnedPath[]): Promise<void> {
  for (const owned of directories) {
    const info = await lstat(owned.path).catch(() => null);
    if (info === null || !info.isDirectory() || !sameIdentity(owned, info)) {
      throw new CommitFailure(
        "write-failed",
        owned.path,
        `Refused to use target root "${owned.path}": it changed while it was being created.`,
      );
    }
  }
}

/** Refuses what no filesystem call could tell us: a relative path, or the same path listed twice. */
function checkPaths(root: string, files: PendingFile[]): void {
  if (!isAbsolute(root)) {
    throw new CommitFailure(
      "write-failed",
      root,
      `Refused to use target root "${root}": the root is not absolute.`,
    );
  }
  const normalizedRoot = resolve(root);
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
    if (!isInside(normalizedRoot, key)) {
      throw new CommitFailure(
        "write-failed",
        path,
        `Refused to write "${path}": it is outside the target root "${root}".`,
      );
    }
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
async function checkDestinations(root: string, files: PendingFile[]): Promise<string> {
  let resolvedRoot: string;
  try {
    const rootInfo = await stat(root);
    if (!rootInfo.isDirectory()) {
      throw new CommitFailure(
        "not-writable",
        root,
        `Refused to use target root "${root}": it is not a directory.`,
      );
    }
    resolvedRoot = await realpath(root);
  } catch (error) {
    if (error instanceof CommitFailure) throw error;
    throw new CommitFailure("not-writable", root, notWritable(root));
  }
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
    await checkResolvedInside(resolvedRoot, anchor.path);
    try {
      await access(anchor.path, constants.W_OK | constants.X_OK);
    } catch {
      throw new CommitFailure("not-writable", anchor.path, notWritable(anchor.path));
    }
  }
  return resolvedRoot;
}

/** Opens an empty temporary file, proves where its inode lives, then writes through the stable FD. */
async function stage(file: PendingFile, resolvedRoot: string): Promise<Staged> {
  const destination = file.absolutePath;
  const temporary = join(
    dirname(destination),
    `${TEMPORARY_PREFIX}${randomBytes(8).toString("hex")}${TEMPORARY_SUFFIX}`,
  );
  let identity: FileIdentity | null = null;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      const info = await handle.stat();
      identity = { dev: info.dev, ino: info.ino };
      await verifyFileInside(resolvedRoot, temporary, identity);
      await handle.writeFile(file.bytes);
      return {
        temporary,
        destination,
        identity,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (identity !== null && !(await removeOwnedFile({ path: temporary, ...identity }))) {
      throw new CommitFailure(
        "write-failed",
        destination,
        `${writeFailed(destination, error)} Cleanup was incomplete. This path may still exist; inspect it before retrying: ${temporary}.`,
        [temporary],
      );
    }
    throw new CommitFailure("write-failed", destination, writeFailed(destination, error));
  }
}

async function verifyFileInside(
  resolvedRoot: string,
  path: string,
  identity: FileIdentity,
): Promise<void> {
  const resolvedPath = await realpath(path).catch((error: unknown) => {
    throw new CommitFailure("write-failed", path, writeFailed(path, error));
  });
  const current = await lstat(path).catch(() => null);
  if (current === null || !current.isFile() || !sameIdentity(identity, current)) {
    throw new CommitFailure(
      "write-failed",
      path,
      `Refused to stage through "${path}": it changed after the file was opened.`,
    );
  }
  if (!isInside(resolvedRoot, resolvedPath)) {
    throw new CommitFailure(
      "write-failed",
      path,
      `Refused to stage through "${path}": it resolves outside the target root.`,
    );
  }
}

/** Publishes a staged file at its destination. Never overwrites: `link` fails if the path exists. */
async function place({ temporary, destination }: Staged): Promise<void> {
  try {
    await link(temporary, destination);
  } catch (error) {
    if (codeOf(error) === "EEXIST") {
      throw new CommitFailure("path-exists", destination, alreadyExists(destination));
    }
    throw new CommitFailure("write-failed", destination, writeFailed(destination, error));
  }
}

/** Creates the missing directories of a chain, recording only the ones this commit created. */
async function createParents(
  directory: string,
  resolvedRoot: string,
  createdDirs: OwnedPath[],
): Promise<void> {
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
      await mkdir(missingDir, { mode: 0o700 });
      await checkResolvedInside(resolvedRoot, missingDir);
      const info = await lstat(missingDir);
      createdDirs.push({ path: missingDir, dev: info.dev, ino: info.ino });
    } catch (error) {
      if (codeOf(error) === "EEXIST") continue; // someone else created it; not ours to remove
      throw new CommitFailure("write-failed", missingDir, writeFailed(missingDir, error));
    }
  }
}

/** Removes leftover staged files and returns the exact paths that could not be removed. */
async function discard(staged: Staged[]): Promise<string[]> {
  const remaining: string[] = [];
  for (const item of staged) {
    const owned = { path: item.temporary, ...item.identity };
    if (!(await removeOwnedFile(owned))) remaining.push(item.temporary);
  }
  return remaining;
}

/** Lists paths created by the commit, with directories ordered deepest first. */
function createdPathNames(files: OwnedPath[], directories: OwnedPath[]): string[] {
  return [...files.map(({ path }) => path), ...[...directories].reverse().map(({ path }) => path)];
}

async function removeOwnedFile(owned: OwnedPath): Promise<boolean> {
  const current = await identityAt(owned.path);
  if (current === null) return true;
  if (!sameIdentity(owned, current)) return false;
  try {
    await unlink(owned.path);
    return true;
  } catch (error) {
    return isAbsent(error);
  }
}

async function identityAt(path: string): Promise<FileIdentity | null> {
  try {
    const info = await lstat(path);
    return { dev: info.dev, ino: info.ino };
  } catch (error) {
    if (isAbsent(error)) return null;
    return { dev: Number.NaN, ino: Number.NaN };
  }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function checkResolvedInside(resolvedRoot: string, path: string): Promise<void> {
  const resolvedPath = await realpath(path).catch((error: unknown) => {
    throw new CommitFailure("not-writable", path, writeFailed(path, error));
  });
  if (!isInside(resolvedRoot, resolvedPath)) {
    throw new CommitFailure(
      "write-failed",
      path,
      `Refused to write through "${path}": it resolves outside the target root.`,
    );
  }
}

function isInside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return (
    fromRoot === "" ||
    (!isAbsolute(fromRoot) && !fromRoot.startsWith(`..${sep}`) && fromRoot !== "..")
  );
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

function asCommitFailure(error: unknown, remainingPaths: string[]): CommitError {
  if (remainingPaths.length > 0) {
    const original = error instanceof Error ? `${error.message} ` : "";
    return new CommitFailure(
      "write-failed",
      null,
      `${original}Cleanup was incomplete. These paths were retained or may still exist; inspect them before retrying: ${remainingPaths.join(", ")}.`,
      remainingPaths,
    );
  }
  if (error instanceof CommitFailure) return error;
  return new CommitFailure(
    "write-failed",
    null,
    `Failed to write the requested file: ${reasonOf(error)}. No destination was published. Check the target and the free space, then run the command again.`,
  );
}

function remainingFrom(error: unknown): string[] {
  if (
    typeof error !== "object" ||
    error === null ||
    !("remainingPaths" in error) ||
    !Array.isArray(error.remainingPaths)
  ) {
    return [];
  }
  return error.remainingPaths.filter((path): path is string => typeof path === "string");
}

// FR-53: after successful placement the temporary staging file(s) failed to remove. The published
// destination is already on disk — only the temps need manual removal. `remainingPaths` carries
// only the temps so callers do not list a successfully committed file as a leftover.
function cleanupFailure(temporaryPaths: string[], publishedPaths: string[]): CommitFailure {
  return new CommitFailure(
    "write-failed",
    null,
    `The file was placed successfully, but the temporary staging file could not be removed. Only these paths need inspection or manual removal: ${temporaryPaths.join(", ")}. The destination was published successfully: ${publishedPaths.join(", ")}. A retry will report path-exists because the import already landed.`,
    temporaryPaths,
  );
}

function alreadyExists(path: string): string {
  return `Refused to write "${path}": that path already exists. This tool only adds files. Remove or rename the existing file, or choose a different target, then run the command again.`;
}

function notWritable(directory: string): string {
  return `Refused to write into "${directory}": the directory is not writable. Check its permissions, or choose a different target, then run the command again.`;
}

function writeFailed(path: string, cause: unknown): string {
  return `Failed to write "${path}": ${reasonOf(cause)}. Check the path and the free space, then run the command again.`;
}

function codeOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

function isAbsent(error: unknown): boolean {
  const code = codeOf(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
