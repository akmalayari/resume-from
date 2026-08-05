// T-STO-1 .. T-STO-12, T-STO-14, T-STO-16.
// Every test runs against a temporary directory. No test touches a real agent home.

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitError, FileCommitter, PendingFile } from "./contract.js";
import { createFileCommitter } from "./file-committer.js";
import { entriesOf, exists, isRoot, makeHome, removeHome, snapshot } from "./test-support.js";

// Records every file opened for writing, so a refusal can be shown to write nothing at all —
// a checksum alone cannot tell "never wrote" from "wrote, then cleaned up perfectly".
const opened = vi.hoisted(() => ({ forWriting: [] as string[] }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (path: string, flags?: string | number, mode?: string | number) => {
      if (flags !== undefined && flags !== "r") opened.forWriting.push(String(path));
      return await actual.open(path, flags, mode);
    },
  };
});

let home: string;
let committer: FileCommitter;

beforeEach(async () => {
  home = await makeHome();
  committer = createFileCommitter();
  opened.forWriting = [];
});

afterEach(async () => {
  await removeHome(home);
});

function file(absolutePath: string, content: string | Buffer): PendingFile {
  return { absolutePath, bytes: Buffer.isBuffer(content) ? content : Buffer.from(content) };
}

/** Awaits a commit that must be refused and returns the refusal. */
async function refusalOf(commit: Promise<unknown>): Promise<CommitError> {
  try {
    await commit;
  } catch (error) {
    return error as CommitError;
  }
  throw new Error("expected the commit to be refused, but it resolved");
}

describe("unit", () => {
  it("T-STO-1 — a commit creates every file", async () => {
    const one = join(home, "one.txt");
    const two = join(home, "two.txt");
    const three = join(home, "three.txt");

    const handle = await committer.commit([
      file(one, "alpha"),
      file(two, "beta"),
      file(three, "gamma"),
    ]);

    expect(handle.createdPaths).toEqual([one, two, three]);
    await expect(readFile(one, "utf8")).resolves.toBe("alpha");
    await expect(readFile(two, "utf8")).resolves.toBe("beta");
    await expect(readFile(three, "utf8")).resolves.toBe("gamma");
  });

  it("T-STO-2 — missing parent directories are created", async () => {
    const deep = join(home, "projects", "abc", "sessions", "s1.jsonl");

    const handle = await committer.commit([file(deep, "line")]);

    expect(handle.createdPaths).toEqual([deep]);
    await expect(readFile(deep, "utf8")).resolves.toBe("line");
  });

  it("T-STO-3 — an existing path refuses the whole commit", async () => {
    const first = join(home, "first.txt");
    const second = join(home, "second.txt");
    const third = join(home, "third.txt");
    await writeFile(second, "already here");

    const refusal = await refusalOf(
      committer.commit([file(first, "a"), file(second, "b"), file(third, "c")]),
    );

    expect(refusal.refusal).toBe("path-exists");
    expect(refusal.path).toBe(second);
    await expect(exists(first)).resolves.toBe(false);
    await expect(exists(third)).resolves.toBe(false);
    await expect(readFile(second, "utf8")).resolves.toBe("already here");
  });

  it("T-STO-4 — a refusal writes nothing at all", async () => {
    const first = join(home, "first.txt");
    const second = join(home, "second.txt");
    const third = join(home, "nested", "third.txt");
    await writeFile(second, "already here");
    const before = await snapshot(home);

    const refusal = await refusalOf(
      committer.commit([file(first, "a"), file(second, "b"), file(third, "c")]),
    );

    expect(refusal.refusal).toBe("path-exists");
    expect(await snapshot(home)).toEqual(before);
    // The existence check ran before the first byte: not even a temporary file was opened.
    expect(opened.forWriting).toEqual([]);
  });

  it("T-STO-5 — a failure part-way through removes what was created", async () => {
    // The third destination cannot be created: its parent path is an existing regular file,
    // which only the write itself can discover.
    const first = join(home, "first.txt");
    const second = join(home, "second.txt");
    const blocker = join(home, "blocker.txt");
    await writeFile(blocker, "i am a file, not a directory");
    const third = join(blocker, "third.txt");
    const before = await snapshot(home);

    const refusal = await refusalOf(
      committer.commit([file(first, "a"), file(second, "b"), file(third, "c")]),
    );

    expect(refusal.refusal).toBe("write-failed");
    await expect(exists(first)).resolves.toBe(false);
    await expect(exists(second)).resolves.toBe(false);
    expect(await snapshot(home)).toEqual(before);
  });

  it("T-STO-6 — rollback removes exactly what the commit created", async () => {
    const kept = join(home, "kept.txt");
    await writeFile(kept, "untouched");
    const existingDir = join(home, "existing");
    await mkdir(existingDir);
    const inExisting = join(existingDir, "new.txt");
    const inFreshDir = join(home, "fresh", "deeper", "new.txt");

    const handle = await committer.commit([file(inExisting, "a"), file(inFreshDir, "b")]);
    await handle.rollback();

    await expect(exists(inExisting)).resolves.toBe(false);
    await expect(exists(inFreshDir)).resolves.toBe(false);
    await expect(exists(join(home, "fresh", "deeper"))).resolves.toBe(false);
    await expect(exists(join(home, "fresh"))).resolves.toBe(false);
    await expect(exists(existingDir)).resolves.toBe(true);
    await expect(readFile(kept, "utf8")).resolves.toBe("untouched");
  });

  it("T-STO-7 — rollback is idempotent", async () => {
    const one = join(home, "dir", "one.txt");
    const two = join(home, "dir", "two.txt");
    const handle = await committer.commit([file(one, "a"), file(two, "b")]);

    await expect(handle.rollback()).resolves.toBeUndefined();
    await expect(handle.rollback()).resolves.toBeUndefined();

    const second = await committer.commit([file(one, "a"), file(two, "b")]);
    await rm(one); // deleted by hand, behind the handle's back
    await expect(second.rollback()).resolves.toBeUndefined();
    await expect(exists(two)).resolves.toBe(false);
  });
});

describe("integration contract", () => {
  const outcomes = [
    { name: "success", refusal: null },
    { name: "path-exists", refusal: "path-exists" },
    { name: "write-failed", refusal: "write-failed" },
  ] as const;

  it.each(outcomes)("T-STO-8 — a commit handle is returned only on full success ($name)", async ({
    refusal,
  }) => {
    const first = join(home, "first.txt");
    let second = join(home, "second.txt");
    if (refusal === "path-exists") {
      await writeFile(second, "already here");
    }
    if (refusal === "write-failed") {
      const blocker = join(home, "blocker.txt");
      await writeFile(blocker, "not a directory");
      second = join(blocker, "second.txt");
    }
    const files = [file(first, "a"), file(second, "b")];

    if (refusal === null) {
      const handle = await committer.commit(files);
      expect(handle.createdPaths).toEqual([first, second]);
      expect(typeof handle.rollback).toBe("function");
      return;
    }

    const error = await refusalOf(committer.commit(files));
    expect(error.refusal).toBe(refusal);
    expect(error.path).toBe(second);
    expect(error.message).toContain(second);
    // FR-56: the message says what the user can do next.
    expect(error.message).toMatch(/remove|rename|choose|check|free|pass/i);
  });

  it("T-STO-9 — bytes are written unchanged", async () => {
    const cases = [
      { name: "invalid-utf8.bin", bytes: Buffer.from([0xff, 0xfe, 0x80, 0x00, 0xc3]) },
      { name: "lone-cr.txt", bytes: Buffer.from("first\rsecond\r") },
      { name: "trailing-null.txt", bytes: Buffer.from([0x74, 0x61, 0x69, 0x6c, 0x00]) },
    ];
    const files = cases.map((one) => file(join(home, one.name), one.bytes));

    await committer.commit(files);

    for (const one of cases) {
      const written = await readFile(join(home, one.name));
      expect(Buffer.compare(written, one.bytes)).toBe(0);
    }
  });

  it("T-STO-10 — an empty commit succeeds and does nothing", async () => {
    const before = await snapshot(home);

    const handle = await committer.commit([]);

    expect(handle.createdPaths).toEqual([]);
    await expect(handle.rollback()).resolves.toBeUndefined();
    expect(await snapshot(home)).toEqual(before);
  });
});

describe("boundary", () => {
  it("T-STO-11 — a relative path is refused", async () => {
    const relativePath = join("relative-store-test", "file.txt");

    const refusal = await refusalOf(committer.commit([file(relativePath, "a")]));

    expect(refusal.path).toBe(relativePath);
    expect(refusal.message).toContain(relativePath);
    expect(opened.forWriting).toEqual([]);
    // The path is never resolved against the current directory.
    await expect(exists(resolve(process.cwd(), relativePath))).resolves.toBe(false);
    await expect(exists(resolve(process.cwd(), "relative-store-test"))).resolves.toBe(false);
  });

  it("T-STO-12 — two files with the same path in one commit are refused", async () => {
    const twice = join(home, "same.txt");
    const before = await snapshot(home);

    const refusal = await refusalOf(committer.commit([file(twice, "first"), file(twice, "second")]));

    expect(refusal.path).toBe(twice);
    // Named as a duplicate, not reported as a file the user already had.
    expect(refusal.message).toMatch(/twice/i);
    await expect(exists(twice)).resolves.toBe(false);
    expect(await snapshot(home)).toEqual(before);
    expect(opened.forWriting).toEqual([]);
  });

  it.skipIf(isRoot)("T-STO-14 — a destination directory that is not writable", async () => {
    const locked = join(home, "locked");
    await mkdir(locked);
    await chmod(locked, 0o555);

    const refusal = await refusalOf(committer.commit([file(join(locked, "new.txt"), "a")]));

    expect(refusal.refusal).toBe("not-writable");
    expect(refusal.message).toContain(locked);
    await expect(entriesOf(locked)).resolves.toEqual([]);
    expect(opened.forWriting).toEqual([]);
  });
});

describe("behavior", () => {
  it("T-STO-16 — a target home is never damaged", async () => {
    for (let index = 0; index < 50; index += 1) {
      await writeFile(join(home, `existing-${index}.txt`), `content ${index}`);
    }
    const before = await snapshot(home);

    const added = [join(home, "added-one.txt"), join(home, "added-two.txt")];
    await committer.commit(added.map((path) => file(path, `bytes of ${path}`)));

    const after = await snapshot(home);
    for (const [path, checksum] of before) {
      expect(after.get(path)).toBe(checksum);
    }
    const fresh = [...after.keys()].filter((path) => !before.has(path)).sort();
    expect(fresh).toEqual(["added-one.txt", "added-two.txt"]);
  });
});
