// T-STO-13 — a destination that appears between the existence check and the moment the file is
// placed. The filesystem is mocked (a system boundary) to make the race deterministic.

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
  };
});

let home: string;
let committer: FileCommitter;

beforeEach(async () => {
  home = await makeHome();
  committer = createFileCommitter();
  intruder.armed = null;
});

afterEach(async () => {
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
