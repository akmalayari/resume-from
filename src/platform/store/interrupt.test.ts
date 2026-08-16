// T-STO-17 — a commit killed part-way through leaves no destination file behind. The commit runs in
// a child process that is SIGKILLed while it is still staging, so no later cleanup can run.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import { makeHome, removeHome } from "./test-support.js";

// 256 MB keeps the write in flight when SIGKILL lands (T-STO-17): the commit cannot complete
// before the OS flushes the buffer, so the kill reliably arrives before the link step.
// This test intentionally takes up to 30 seconds and is not suited for fast-feedback loops.
const FILE_SIZE = 256 * 1024 * 1024;

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
      "const files = [{",
      '  absolutePath: target + "/session.jsonl",',
      `  bytes: Buffer.alloc(${FILE_SIZE}, 65),`,
      "}];",
      "await createFileCommitter().commit(target, files);",
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

  // Kill after the private temporary file appears but before it is linked to the destination.
  const deadline = Date.now() + 15_000;
  let killed = false;
  while (Date.now() < deadline && child.exitCode === null) {
    const names = await readdir(target).catch(() => [] as string[]);
    if (names.some((name) => name.startsWith(".resume-from-") && name.endsWith(".tmp"))) {
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
