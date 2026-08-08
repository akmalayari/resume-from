// T-REP-11 .. T-REP-14 — Boundary Tests of src/platform/repo/module.md.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, test } from "vitest";
import { runGit } from "./git.js";
import { createRepoReader } from "./index.js";
import {
  checksumTree,
  cleanupTempDirs,
  commitFile,
  commitSeries,
  makeDir,
  repoWithOneCommit,
  tempDir,
} from "./test-support.js";

afterAll(cleanupTempDirs);

const moduleDir = dirname(fileURLToPath(import.meta.url));

test("T-REP-11 — a hostile revision string is safe", async () => {
  const { dir } = await repoWithOneCommit();
  const reader = createRepoReader(dir);

  const hostile = [
    { name: "a shell fragment", revision: "; rm -rf /" },
    {
      name: "an option that runs a program",
      revision: "--upload-pack=touch pwned",
    },
    { name: "a 10 kB revision", revision: "a".repeat(10 * 1024) },
    { name: "an empty revision", revision: "" },
  ];

  for (const { name, revision } of hostile) {
    const distance = await reader.distanceFrom(revision);
    expect(distance, name).toEqual({ known: false, ahead: 0, behind: 0 });
  }

  // Nothing a shell would have created exists: not in the repository git ran in, not in the
  // directory this process runs in.
  expect(existsSync(join(dir, "pwned"))).toBe(false);
  expect(existsSync(join(process.cwd(), "pwned"))).toBe(false);
});

test("T-REP-12 — the repository is never modified", async () => {
  const dir = (await repoWithOneCommit()).dir;
  const source = await commitFile(dir, "source");
  await commitSeries(dir, 2);
  const nested = await makeDir(dir, "nested");
  const outside = await tempDir("resume-from-plain-");
  const reader = createRepoReader(dir);

  const calls: Array<[string, () => Promise<unknown>]> = [
    ["identify(root)", () => reader.identify(dir)],
    ["identify(nested)", () => reader.identify(nested)],
    ["identify(outside)", () => reader.identify(outside)],
    ["distanceFrom(known)", () => reader.distanceFrom(source)],
    ["distanceFrom(unknown)", () => reader.distanceFrom("1".repeat(40))],
    ["distanceFrom(hostile)", () => reader.distanceFrom("; touch pwned")],
  ];

  for (const [name, call] of calls) {
    const before = await checksumTree(dir);
    await call();
    expect(await checksumTree(dir), name).toEqual(before);
  }
});

test("T-REP-13 — no caching between calls", async () => {
  const { dir, head } = await repoWithOneCommit();
  const reader = createRepoReader(dir);

  expect((await reader.identify(dir)).head).toBe(head);

  const second = await commitFile(dir, "second");

  expect(second).not.toBe(head);
  expect((await reader.identify(dir)).head).toBe(second);
});

test("T-REP-14 — the module knows nothing about sessions", async () => {
  // Assembled from segments so this file never contains a specifier it is meant to forbid.
  const forbiddenRoots = ["session", "adapters", "import", "host"];
  const allowedPackages = ["vitest"];

  const files = (await readdir(moduleDir)).filter((name) => name.endsWith(".ts"));
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    const source = await readFile(join(moduleDir, file), "utf8");
    for (const specifier of importSpecifiersOf(source)) {
      const segments = specifier.split("/");
      for (const root of forbiddenRoots) {
        expect(segments, `${file} imports ${specifier}`).not.toContain(root);
      }
      // This module depends on no other module: every import is a node builtin, a test-runner
      // package, or a file of this folder. Nothing reaches outside the folder at all.
      const local = specifier.startsWith("./") && !specifier.includes("..");
      const external = specifier.startsWith("node:") || allowedPackages.includes(specifier);
      expect(local || external, `${file} imports ${specifier}`).toBe(true);
    }
  }
});

test("a git subprocess is stopped after its finite timeout", async () => {
  const dir = await tempDir("resume-from-git-timeout-");

  await expect(runGit(dir, ["hash-object", "--stdin"], { timeoutMs: 20 })).rejects.toThrow(
    "timed out after 20 ms",
  );
});

test("the reader factory passes an AbortSignal to every git subprocess", async () => {
  const dir = await tempDir("resume-from-git-abort-");
  const controller = new AbortController();
  controller.abort();

  await expect(createRepoReader(dir, { signal: controller.signal }).identify(dir)).rejects.toThrow(
    "aborted",
  );
});

test("the reader factory rejects an unbounded timeout", async () => {
  const dir = await tempDir("resume-from-git-invalid-timeout-");

  expect(() => createRepoReader(dir, { timeoutMs: Number.POSITIVE_INFINITY })).toThrow(
    "timeoutMs must be a positive, finite integer",
  );
});

function importSpecifiersOf(source: string): string[] {
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ];
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) found.add(specifier);
    }
  }
  return [...found];
}
