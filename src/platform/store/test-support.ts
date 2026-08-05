// Helpers shared by this module's tests. Every test runs against a temporary directory
// created here and removed afterwards; no test touches a real agent home (C-3).

import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/** Creates a throwaway home. The caller removes it with {@link removeHome}. */
export async function makeHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "resume-from-store-"));
}

/** Removes a throwaway home, restoring permissions first so an unwritable test directory goes too. */
export async function removeHome(root: string): Promise<void> {
  await makeWritable(root);
  await rm(root, { recursive: true, force: true });
}

/** Restores write permission on every directory under `root`, so `rm` can finish. */
export async function makeWritable(root: string): Promise<void> {
  try {
    await chmod(root, 0o700);
  } catch {
    return;
  }
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(root, name);
    const info = await lstat(full).catch(() => null);
    if (info?.isDirectory()) {
      await makeWritable(full);
    }
  }
}

/**
 * Maps every path under `root` to a checksum of its content, or to "dir" for a directory.
 * Two identical snapshots mean nothing was added, removed or changed — including temporary files.
 */
export async function snapshot(root: string): Promise<Map<string, string>> {
  const tree = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const key = relative(root, full);
      if (entry.isDirectory()) {
        tree.set(key, "dir");
        await walk(full);
      } else {
        tree.set(
          key,
          createHash("sha256")
            .update(await readFile(full))
            .digest("hex"),
        );
      }
    }
  };
  await walk(root);
  return tree;
}

/** True when the path exists, without following symlinks. */
export async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null)) !== null;
}

/** The names directly inside a directory, sorted. */
export async function entriesOf(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

/** Permission tests are meaningless as root: root ignores the write bit. */
export const isRoot = process.getuid?.() === 0;
