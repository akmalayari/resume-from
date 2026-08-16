// T-STO-1 .. T-STO-12, T-STO-14, T-STO-16.
// Every test runs against a temporary directory. No test touches a real agent home.

import { chmod, mkdir, readFile, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitError, FileCommitter, PendingFile } from "./contract.js";
import { createFileCommitter } from "./file-committer.js";
import { entriesOf, exists, isRoot, makeHome, removeHome, snapshot } from "./test-support.js";

// The filesystem is watched, and on request made to fail. Watching `open` lets a refusal be shown
// to write nothing at all — a checksum alone cannot tell "never wrote" from "wrote, then cleaned up
// perfectly". Watching `lstat` proves a cardinality refusal happens before filesystem inspection.
const fs = vi.hoisted(() => ({
  openedForWriting: [] as string[],
  inspected: [] as string[],
  swapBeforeOpen: null as null | {
    parent: string;
    outside: string;
    moved: string;
  },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (path: string, flags?: string | number, mode?: string | number) => {
      const pendingSwap = fs.swapBeforeOpen;
      if (pendingSwap !== null && String(path).startsWith(`${pendingSwap.parent}/.resume-from-`)) {
        fs.swapBeforeOpen = null;
        await actual.rename(pendingSwap.parent, pendingSwap.moved);
        await actual.symlink(pendingSwap.outside, pendingSwap.parent);
      }
      if (flags !== undefined && flags !== "r") fs.openedForWriting.push(String(path));
      return await actual.open(path, flags, mode);
    },
    lstat: async (path: string) => {
      fs.inspected.push(String(path));
      return await actual.lstat(path);
    },
  };
});

let home: string;
let committer: FileCommitter;

beforeEach(async () => {
  home = await makeHome();
  committer = createFileCommitter();
  fs.openedForWriting = [];
  fs.inspected = [];
  fs.swapBeforeOpen = null;
});

afterEach(async () => {
  await removeHome(home);
});

function file(absolutePath: string, content: string | Buffer): PendingFile {
  return {
    absolutePath,
    bytes: Buffer.isBuffer(content) ? content : Buffer.from(content),
  };
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
  it("T-STO-1 — a commit creates its file", async () => {
    const destination = join(home, "session.jsonl");

    const handle = await committer.commit(home, [file(destination, "alpha")]);

    expect(handle.createdPaths).toEqual([destination]);
    await expect(readFile(destination, "utf8")).resolves.toBe("alpha");
  });

  it("T-STO-2 — missing parent directories are created", async () => {
    const deep = join(home, "projects", "abc", "sessions", "s1.jsonl");

    const handle = await committer.commit(home, [file(deep, "line")]);

    expect(handle.createdPaths).toEqual([deep]);
    await expect(readFile(deep, "utf8")).resolves.toBe("line");
  });

  it("creates a missing target root privately and reports the published file", async () => {
    const root = join(home, "new-target", "profile");
    const destination = join(root, "sessions", "session.jsonl");

    const handle = await committer.commit(root, [file(destination, "line")]);

    expect((await stat(root)).mode & 0o777).toBe(0o700);
    await expect(readFile(destination, "utf8")).resolves.toBe("line");
    expect(handle.createdPaths).toEqual([destination]);
  });

  it("T-STO-3 — an existing path refuses the commit", async () => {
    const destination = join(home, "session.jsonl");
    await writeFile(destination, "already here");

    const refusal = await refusalOf(committer.commit(home, [file(destination, "new")]));

    expect(refusal.refusal).toBe("path-exists");
    expect(refusal.path).toBe(destination);
    await expect(readFile(destination, "utf8")).resolves.toBe("already here");
  });

  it("T-STO-4 — a refusal writes nothing at all", async () => {
    const destination = join(home, "session.jsonl");
    await writeFile(destination, "already here");
    const before = await snapshot(home);
    fs.inspected = [];

    const refusal = await refusalOf(committer.commit(home, [file(destination, "new")]));

    expect(refusal.refusal).toBe("path-exists");
    expect(await snapshot(home)).toEqual(before);
    // The existence check ran before the first byte: not even a temporary file was opened.
    expect(fs.openedForWriting).toEqual([]);
  });

  it("T-STO-5 — more than one file is refused before filesystem access", async () => {
    const first = join(home, "first.txt");
    const second = join(home, "second.txt");
    const before = await snapshot(home);
    fs.inspected = [];

    const refusal = await refusalOf(committer.commit(home, [file(first, "a"), file(second, "b")]));

    expect(refusal.refusal).toBe("write-failed");
    expect(refusal.path).toBeNull();
    expect(refusal.message).toMatch(/one file|atomic/i);
    expect(fs.inspected).toEqual([]);
    expect(fs.openedForWriting).toEqual([]);
    await expect(exists(first)).resolves.toBe(false);
    await expect(exists(second)).resolves.toBe(false);
    expect(await snapshot(home)).toEqual(before);
  });

  it("T-STO-6 — a handle reports the published path without a removal operation", async () => {
    const kept = join(home, "kept.txt");
    await writeFile(kept, "untouched");
    const existingDir = join(home, "existing");
    await mkdir(existingDir);
    const inFreshDir = join(home, "fresh", "deeper", "new.txt");

    const handle = await committer.commit(home, [file(inFreshDir, "b")]);
    expect(handle).toEqual({ createdPaths: [inFreshDir] });
    expect("rollback" in handle).toBe(false);
    await expect(readFile(inFreshDir, "utf8")).resolves.toBe("b");
    await expect(exists(existingDir)).resolves.toBe(true);
    await expect(readFile(kept, "utf8")).resolves.toBe("untouched");
  });

  it("T-STO-7 — an empty commit has no rollback operation", async () => {
    const empty = await committer.commit(home, []);
    expect(empty).toEqual({ createdPaths: [] });
    expect("rollback" in empty).toBe(false);
  });

  it("creates files and directories with private modes", async () => {
    const directory = join(home, "private", "nested");
    const destination = join(directory, "session.jsonl");

    await committer.commit(home, [file(destination, "secret")]);

    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(home, "private"))).mode & 0o777).toBe(0o700);
  });

  it("does not expose an unlink operation that could delete a replacement", async () => {
    const destination = join(home, "session.jsonl");
    const handle = await committer.commit(home, [file(destination, "created")]);
    await unlink(destination);
    await writeFile(destination, "replacement");
    expect(handle.createdPaths).toEqual([destination]);
    expect("rollback" in handle).toBe(false);
    await expect(readFile(destination, "utf8")).resolves.toBe("replacement");
  });
});

describe("integration contract", () => {
  const outcomes = [
    { name: "success", refusal: null },
    { name: "path-exists", refusal: "path-exists" },
    { name: "write-failed", refusal: "write-failed" },
  ] as const;

  it.each(outcomes)(
    "T-STO-8 — a commit handle is returned only on full success ($name)",
    async ({ refusal }) => {
      let destination = join(home, "session.jsonl");
      if (refusal === "path-exists") {
        await writeFile(destination, "already here");
      }
      if (refusal === "write-failed") {
        const blocker = join(home, "blocker.txt");
        await writeFile(blocker, "not a directory");
        destination = join(blocker, "session.jsonl");
      }
      const files = [file(destination, "bytes")];

      if (refusal === null) {
        const handle = await committer.commit(home, files);
        expect(handle.createdPaths).toEqual([destination]);
        expect("rollback" in handle).toBe(false);
        return;
      }

      const error = await refusalOf(committer.commit(home, files));
      expect(error.refusal).toBe(refusal);
      expect(error.path).toBe(destination);
      expect(error.message).toContain(destination);
      // FR-56: the message names the specific next step for the refusal type.
      expect(error.message).toContain(
        refusal === "path-exists"
          ? "Remove or rename the existing file"
          : "Check the path and the free space",
      );
    },
  );

  it("T-STO-9 — bytes are written unchanged", async () => {
    const cases = [
      {
        name: "invalid-utf8.bin",
        bytes: Buffer.from([0xff, 0xfe, 0x80, 0x00, 0xc3]),
      },
      { name: "lone-cr.txt", bytes: Buffer.from("first\rsecond\r") },
      {
        name: "trailing-null.txt",
        bytes: Buffer.from([0x74, 0x61, 0x69, 0x6c, 0x00]),
      },
    ];
    for (const one of cases) {
      await committer.commit(home, [file(join(home, one.name), one.bytes)]);
      const written = await readFile(join(home, one.name));
      expect(Buffer.compare(written, one.bytes)).toBe(0);
    }
  });

  it("T-STO-10 — an empty commit succeeds and does nothing", async () => {
    const before = await snapshot(home);

    const handle = await committer.commit(home, []);

    expect(handle.createdPaths).toEqual([]);
    expect("rollback" in handle).toBe(false);
    expect(await snapshot(home)).toEqual(before);
  });
});

describe("boundary", () => {
  it("T-STO-11 — a relative path is refused", async () => {
    const relativePath = join("relative-store-test", "file.txt");

    const refusal = await refusalOf(committer.commit(home, [file(relativePath, "a")]));

    expect(refusal.path).toBe(relativePath);
    expect(refusal.message).toContain(relativePath);
    expect(fs.openedForWriting).toEqual([]);
    // The path is never resolved against the current directory.
    await expect(exists(resolve(process.cwd(), relativePath))).resolves.toBe(false);
    await expect(exists(resolve(process.cwd(), "relative-store-test"))).resolves.toBe(false);
  });

  it("T-STO-12 — any two files in one commit are refused", async () => {
    const first = join(home, "first.txt");
    const second = join(home, "second.txt");
    const before = await snapshot(home);
    fs.inspected = [];

    const refusal = await refusalOf(
      committer.commit(home, [file(first, "first"), file(second, "second")]),
    );

    expect(refusal.path).toBeNull();
    expect(refusal.message).toMatch(/one file|atomic/i);
    expect(fs.inspected).toEqual([]);
    await expect(exists(first)).resolves.toBe(false);
    await expect(exists(second)).resolves.toBe(false);
    expect(await snapshot(home)).toEqual(before);
    expect(fs.openedForWriting).toEqual([]);
  });

  it("refuses lexical paths outside the target root", async () => {
    const outside = join(home, "..", `${home.split("/").at(-1)}-outside.jsonl`);

    const refusal = await refusalOf(committer.commit(home, [file(outside, "secret")]));

    expect(refusal.path).toBe(outside);
    expect(refusal.message).toMatch(/outside the target root/i);
    expect(fs.openedForWriting).toEqual([]);
  });

  it("refuses an existing symlink that escapes the target root", async () => {
    const outside = await makeHome();
    const linked = join(home, "linked");
    await symlink(outside, linked);
    try {
      const destination = join(linked, "session.jsonl");

      const refusal = await refusalOf(committer.commit(home, [file(destination, "secret")]));

      expect(refusal.path).toBe(linked);
      expect(refusal.message).toMatch(/outside the target root/i);
      await expect(exists(join(outside, "session.jsonl"))).resolves.toBe(false);
      expect(fs.openedForWriting).toEqual([]);
    } finally {
      await removeHome(outside);
    }
  });

  it("refuses a parent swapped outside the root before staging any session byte", async () => {
    const outside = await makeHome();
    const parent = join(home, "sessions");
    const moved = join(home, "sessions-before-swap");
    await mkdir(parent);
    fs.swapBeforeOpen = { parent, outside, moved };
    try {
      const destination = join(parent, "session.jsonl");

      const refusal = await refusalOf(
        committer.commit(home, [file(destination, "secret session bytes")]),
      );

      expect(refusal.refusal).toBe("write-failed");
      expect(refusal.message).toMatch(/outside the target root/i);
      expect(await snapshot(outside)).toEqual(new Map());
      await expect(entriesOf(moved)).resolves.toEqual([]);
    } finally {
      await removeHome(outside);
    }
  });

  it.skipIf(isRoot)("T-STO-14 — a destination directory that is not writable", async () => {
    const locked = join(home, "locked");
    await mkdir(locked);
    await chmod(locked, 0o555);

    const refusal = await refusalOf(committer.commit(home, [file(join(locked, "new.txt"), "a")]));

    expect(refusal.refusal).toBe("not-writable");
    expect(refusal.message).toContain(locked);
    await expect(entriesOf(locked)).resolves.toEqual([]);
    expect(fs.openedForWriting).toEqual([]);
  });
});

describe("behavior", () => {
  it("T-STO-16 — a target home is never damaged", async () => {
    for (let index = 0; index < 50; index += 1) {
      await writeFile(join(home, `existing-${index}.txt`), `content ${index}`);
    }
    const before = await snapshot(home);

    const added = join(home, "added.txt");
    await committer.commit(home, [file(added, `bytes of ${added}`)]);

    const after = await snapshot(home);
    for (const [path, checksum] of before) {
      expect(after.get(path)).toBe(checksum);
    }
    const fresh = [...after.keys()].filter((path) => !before.has(path)).sort();
    expect(fresh).toEqual(["added.txt"]);
  });
});
