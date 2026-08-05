/**
 * Live tests. They need an installed Claude Code and run only under
 * RESUME_FROM_LIVE=1 pnpm vitest run src/adapters/claude-code
 *
 * Every one of them builds a throwaway CLAUDE_CONFIG_DIR below the temporary directory and
 * points Claude Code at it. No test here reads or writes ~/.claude: C-3 says a bad write can
 * damage the user's real sessions, and C-9 states its throwaway-directory result does not lift
 * that risk.
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "./adapter.js";
import type { CanonicalSession, ProvenanceMarker, SerializedSession } from "./contract.js";
import { encodeProjectPath, PROJECTS_DIR, sessionFilePath } from "./layout.js";
import {
  assertThrowaway,
  cleanupThrowaways,
  commitPendingFiles,
  makeThrowawayHome,
  makeThrowawayRoot,
} from "./test-support.js";

const live = process.env.RESUME_FROM_LIVE === "1";
const LIVE_TIMEOUT_MS = 300_000;

const MARKER: ProvenanceMarker = {
  sourceAgent: "codex",
  sourceHome: "/home/testuser/.codex",
  sourceSessionId: "01JQ8Z3K7M4N5P6Q7R8S9T0V1W",
  importedAt: "2026-08-02T10:00:00.000Z",
  droppedSummary: "no tool results dropped",
  lines: ["Imported from codex", "Source session 01JQ8Z3K7M4N5P6Q7R8S9T0V1W"],
};

/** The C-9 scenario: one user turn and one assistant turn. */
const TWO_TURN_SESSION: CanonicalSession = {
  provenance: {
    ref: { agent: "codex", home: "/home/testuser/.codex", id: "01JQ8Z3K7M4N5P6Q7R8S9T0V1W" },
    title: "make the auth token refresh work",
    startedAt: "2026-08-01T09:14:02.000Z",
    updatedAt: "2026-08-01T09:14:05.000Z",
    repo: { commit: null, branch: "main", changedPaths: [] },
  },
  turns: [
    {
      index: 0,
      role: "user",
      kind: "message",
      text: "make the auth token refresh work",
      toolCall: null,
      timestamp: "2026-08-01T09:14:02.000Z",
    },
    {
      index: 1,
      role: "agent",
      kind: "message",
      text: "I'll look at how the token is stored first.",
      toolCall: null,
      timestamp: "2026-08-01T09:14:05.000Z",
    },
  ],
};

function runClaude(
  args: string[],
  options: { cwd: string; home: string },
): ReturnType<typeof spawnSync> {
  assertThrowaway(options.home);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: options.home };
  expect(env.CLAUDE_CONFIG_DIR).toBe(options.home);
  return spawnSync("claude", args, {
    cwd: options.cwd,
    env,
    encoding: "utf8",
    timeout: LIVE_TIMEOUT_MS - 30_000,
  });
}

/** A repository whose name pins the project-directory encoding beyond letters and digits. */
async function makeRepo(): Promise<string> {
  const root = await makeThrowawayRoot();
  const repo = path.join(root, "repo with space+plus");
  await mkdir(repo, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: repo });
  return realpathSync(repo);
}

async function sessionFilesOf(home: string): Promise<string[]> {
  const projects = path.join(home, PROJECTS_DIR);
  if (!existsSync(projects)) return [];
  const found: string[] = [];
  for (const dir of await readdir(projects, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of await readdir(path.join(projects, dir.name))) {
      if (file.endsWith(".jsonl")) found.push(path.join(projects, dir.name, file));
    }
  }
  return found;
}

describe.skipIf(!live)("T-CC-16 — live: the default home and the per-project layout", () => {
  afterAll(async () => {
    await cleanupThrowaways();
  });

  it(
    "puts a session where this module computes it, for a path that is not only letters and digits",
    async () => {
      const home = await makeThrowawayHome();
      const repo = await makeRepo();

      const run = runClaude(["-p", "Reply with the single word READY and nothing else."], {
        cwd: repo,
        home,
      });
      expect(run.status, `claude failed: ${run.stderr}`).toBe(0);

      const written = await sessionFilesOf(home);
      expect(written.length).toBeGreaterThan(0);
      const landed = written[0] as string;

      expect(path.basename(path.dirname(landed))).toBe(encodeProjectPath(repo));
      const id = path.basename(landed, ".jsonl");
      expect(landed).toBe(sessionFilePath(home, repo, id));

      // The declared default home is the one Claude Code itself used.
      const adapter = createClaudeCodeAdapter({
        env: { ...process.env, CLAUDE_CONFIG_DIR: home },
        cwd: repo,
      });
      expect(adapter.capabilities().defaultHome).toBe(home);

      // And this module can read what Claude Code wrote.
      const listed = await adapter.listSessions(home);
      expect(listed.map((descriptor) => descriptor.ref.id)).toContain(id);
      expect(listed[0]?.repoPath).toBe(repo);
    },
    LIVE_TIMEOUT_MS,
  );
});

describe.skipIf(!live)("live: the C-9 scenario", () => {
  let home = "";
  let repo = "";
  let serialized: SerializedSession;
  let bytesBefore = "";
  let firstResume: ReturnType<typeof spawnSync>;

  beforeAll(async () => {
    home = await makeThrowawayHome();
    repo = await makeRepo();
    const adapter = createClaudeCodeAdapter({ cwd: repo });
    serialized = adapter.serialize(
      TWO_TURN_SESSION,
      { agent: "claude-code", home, windowTokens: adapter.capabilities().defaultWindowTokens },
      MARKER,
    );
    expect(adapter.validate(serialized)).toEqual([]);
    await commitPendingFiles(serialized.files);
    bytesBefore = await readFile(serialized.files[0]?.absolutePath as string, "utf8");
    firstResume = runClaude(
      [
        "--resume",
        serialized.sessionId,
        "-p",
        "Reply with the single word RESUMED and nothing else.",
      ],
      { cwd: repo, home },
    );
  }, LIVE_TIMEOUT_MS);

  afterAll(async () => {
    await cleanupThrowaways();
  });

  it(
    "T-CC-17 — Claude Code opens the imported session by id, and the turns are on the screen",
    async () => {
      expect(firstResume.status, `claude --resume failed: ${firstResume.stderr}`).toBe(0);
      expect(String(firstResume.stdout).trim().length).toBeGreaterThan(0);

      const after = await readFile(serialized.files[0]?.absolutePath as string, "utf8");
      // The imported entries are still there, unchanged, and Claude Code continued after them.
      expect(after.startsWith(bytesBefore)).toBe(true);
      expect(after.length).toBeGreaterThan(bytesBefore.length);
      expect(after).toContain("make the auth token refresh work");
      expect(after).toContain("I'll look at how the token is stored first.");

      const adapter = createClaudeCodeAdapter({ cwd: repo });
      const facts = await adapter.readBack(home, serialized.sessionId);
      expect(facts.openable).toBe(true);
      expect(facts.itemCount).toBeGreaterThanOrEqual(serialized.itemCount);

      // The picker lists the session the same way it lists a native one: same directory,
      // same layout, and a real modification time and size.
      const listed = await adapter.listSessions(home);
      const row = listed.find((descriptor) => descriptor.ref.id === serialized.sessionId);
      expect(row?.title).toBe("make the auth token refresh work");
      expect(row?.repoPath).toBe(repo);
      expect(Number.isFinite(Date.parse(row?.updatedAt as string))).toBe(true);
    },
    LIVE_TIMEOUT_MS,
  );

  it(
    "T-CC-18 — the imported turns are native: resume works again on them (FR-41, AC-2)",
    async () => {
      const second = runClaude(
        [
          "--resume",
          serialized.sessionId,
          "-p",
          "Reply with the single word AGAIN and nothing else.",
        ],
        { cwd: repo, home },
      );
      expect(second.status, `second resume failed: ${second.stderr}`).toBe(0);

      const after = await readFile(serialized.files[0]?.absolutePath as string, "utf8");
      const entries = after
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      // Scrollback holds the imported turns and the native ones in one transcript.
      expect(entries.length).toBeGreaterThan(serialized.itemCount);
      expect(after).toContain("make the auth token refresh work");
      const nativeTypes = new Set(entries.slice(serialized.itemCount).map((entry) => entry.type));
      expect(nativeTypes.size).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT_MS,
  );
});
