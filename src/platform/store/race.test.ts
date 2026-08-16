// T-STO-13 — a destination that appears between the existence check and the moment the file is
// placed. Also covers the compound failure where EEXIST and temp cleanup both fail, and the case
// where placement succeeds but temp cleanup fails. The filesystem is mocked (a system boundary)
// to make the races deterministic.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CommitError, FileCommitter } from "./contract.js";
import { createFileCommitter } from "./file-committer.js";
import { entriesOf, makeHome, removeHome } from "./test-support.js";

const intruder = vi.hoisted(() => ({
  armed: null as string | null,
  bytes: Buffer.from("written by another process\n"),
}));

// Controls whether unlink throws EACCES for temporary staging files, simulating a filesystem
// that refuses cleanup after placement. Reset in afterEach before removeHome runs.
const unlinkControl = vi.hoisted(() => ({
  failForTempPaths: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    /** Creates the destination just before the commit tries to place its own file there. */
    link: async (source: string, destination: string) => {
      if (intruder.armed === destination) {
        intruder.armed = null;
        await actual.writeFile(destination, intruder.bytes);
      }
      return await actual.link(source, destination);
    },
    /** Throws EACCES for temp staging paths when the cleanup-failure flag is armed. */
    unlink: async (path: string) => {
      if (
        unlinkControl.failForTempPaths &&
        String(path).includes(".resume-from-") &&
        String(path).endsWith(".tmp")
      ) {
        const err = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        throw err;
      }
      return actual.unlink(path);
    },
  };
});

let home: string;
let committer: FileCommitter;

beforeEach(async () => {
  home = await makeHome();
  committer = createFileCommitter();
  intruder.armed = null;
  unlinkControl.failForTempPaths = false;
});

afterEach(async () => {
  // Reset before removeHome so the mock does not interfere with rm internals.
  unlinkControl.failForTempPaths = false;
  intruder.armed = null;
  await removeHome(home);
});

it("T-STO-13 — a path that appears between the check and the rename", async () => {
  const destination = join(home, "session.jsonl");
  intruder.armed = destination;

  let refusal: CommitError | null = null;
  try {
    await committer.commit(home, [{ absolutePath: destination, bytes: Buffer.from("mine") }]);
  } catch (error) {
    refusal = error as CommitError;
  }

  expect(refusal?.refusal).toBe("path-exists");
  expect(refusal?.path).toBe(destination);
  // The file that appeared is never overwritten.
  expect(Buffer.compare(await readFile(destination), intruder.bytes)).toBe(0);
  // Everything the commit created is gone, temporary files included.
  await expect(entriesOf(home)).resolves.toEqual(["session.jsonl"]);
});

it("placement succeeds but temp cleanup fails — destination is named as published, only temp as leftover", async () => {
  // FR-53: when link succeeds but the temp removal fails, the error must not list the
  // destination as a leftover. A retry would hit path-exists on a successfully imported file.
  const destination = join(home, "session.jsonl");
  unlinkControl.failForTempPaths = true;

  let error: CommitError | null = null;
  try {
    await committer.commit(home, [{ absolutePath: destination, bytes: Buffer.from("landed") }]);
  } catch (caught) {
    error = caught as CommitError;
  }

  // The destination was published and is readable.
  expect(await readFile(destination, "utf8")).toBe("landed");
  // The error names the destination as successfully published.
  expect(error?.message).toContain(destination);
  expect(error?.message).toMatch(/published successfully|placed successfully/i);
  // A retry will hit path-exists, not land again.
  expect(error?.message).toMatch(/retry will report path-exists|already landed/i);
  // Only the temporary path is listed as needing inspection — not the destination.
  expect(error?.remainingPaths).toHaveLength(1);
  expect(error?.remainingPaths?.[0]).toMatch(/\.resume-from-.*\.tmp$/);
  expect(error?.remainingPaths).not.toContain(destination);
});

it("EEXIST race where temp cleanup also fails — message names both the destination and the leftover temp", async () => {
  // FR-56: the path-exists cause must survive in the message even when asCommitFailure wraps the
  // error to write-failed because cleanup also failed (T-STO-13 compound case). The lander needs
  // both paths to produce an actionable message.
  const destination = join(home, "session.jsonl");
  intruder.armed = destination;
  unlinkControl.failForTempPaths = true;

  let error: CommitError | null = null;
  try {
    await committer.commit(home, [{ absolutePath: destination, bytes: Buffer.from("mine") }]);
  } catch (caught) {
    error = caught as CommitError;
  }

  // The refusal degrades to write-failed because asCommitFailure wraps the path-exists cause
  // when there are remaining paths to report.
  expect(error?.refusal).toBe("write-failed");
  expect(error?.path).toBeNull();
  // The message still names the destination (from the alreadyExists text in the wrapped cause).
  expect(error?.message).toContain(destination);
  // The temp path is the only remaining path needing manual cleanup.
  expect(error?.remainingPaths).toHaveLength(1);
  const temp = error?.remainingPaths?.[0];
  expect(temp).toMatch(/\.resume-from-.*\.tmp$/);
  expect(error?.message).toContain(temp);
  // The intruder's file is intact — the commit never overwrote it.
  expect(Buffer.compare(await readFile(destination), intruder.bytes)).toBe(0);
});
