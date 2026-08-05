// T-STO-17 — a commit killed part-way through leaves no destination file behind. The commit runs in
// a child process that is SIGKILLed while it is still staging, so no rollback ever runs.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import { makeHome, removeHome } from "./test-support.js";

// Enough bytes that the child is certainly still mid-commit when the kill lands.
const FILE_COUNT = 64;
const FILE_SIZE = 1024 * 1024;
// Kill only once several files have been written. A commit that placed files as it went would have
// destinations on disk by now; a commit that stages everything first has none.
const ENTRIES_BEFORE_KILL = 4;

let home: string;

beforeEach(async () => {
  home = await makeHome();
});

afterEach(async () => {
  await removeHome(home);
});

it("T-STO-17 — an interrupted commit leaves no partial session", async () => {
  const target = join(home, "target");
  await mkdir(target);
  const committerPath = join(import.meta.dirname, "file-committer.ts");
  const scriptPath = join(home, "child.mjs");
  await writeFile(
    scriptPath,
    [
      `import { createFileCommitter } from ${JSON.stringify(committerPath)};`,
      "const target = process.argv[2];",
      `const files = Array.from({ length: ${FILE_COUNT} }, (_, index) => ({`,
      '  absolutePath: target + "/session-" + index + ".jsonl",',
      `  bytes: Buffer.alloc(${FILE_SIZE}, 65),`,
      "}));",
      "await createFileCommitter().commit(files);",
      'console.log("COMPLETED");',
      "",
    ].join("\n"),
  );

  const child = spawn(process.execPath, [scriptPath, target], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  // Kill part-way through the commit, well after the first file was written.
  const deadline = Date.now() + 15_000;
  let killed = false;
  while (Date.now() < deadline && child.exitCode === null) {
    const names = await readdir(target).catch(() => [] as string[]);
    if (names.length >= ENTRIES_BEFORE_KILL) {
      killed = child.kill("SIGKILL");
      break;
    }
    await delay(1);
  }
  const [, signal] = (await once(child, "exit")) as [number | null, string | null];

  expect(killed, `child was never killed while staging. output: ${output}`).toBe(true);
  expect(signal).toBe("SIGKILL");
  expect(output).not.toContain("COMPLETED");

  const left = await readdir(target);
  // No destination file exists — only temporary files, and they carry a name no agent will read.
  expect(left.filter((name) => name.endsWith(".jsonl"))).toEqual([]);
  expect(left.every((name) => name.startsWith("."))).toBe(true);
}, 30_000);
