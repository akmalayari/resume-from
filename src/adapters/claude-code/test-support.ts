/**
 * Helpers the tests of this module share.
 *
 * Every write goes through `assertThrowaway`, which refuses any path outside the
 * temporary directory. C-3 says a bad write can damage the user's real sessions, so the
 * interlock is a hard failure rather than a convention: if `mkdtemp` or an environment
 * variable ever silently fails, this is what stops a write into ~/.claude.
 *
 * The live tests are the one exception, and they take a second interlock rather than a
 * weaker one: `assertLiveHome` accepts only the pre-authenticated live home of
 * docs/tech-stack.md, which the suite never creates and never logs in to.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { PendingFile } from "./contract.js";
import { sessionFilePath } from "./layout.js";

const createdRoots: string[] = [];

/** Resolve a path, following symlinks as far as the path exists (macOS /var → /private/var). */
function realish(target: string): string {
  let current = path.resolve(target);
  const missing: string[] = [];
  while (!existsSync(current)) {
    missing.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(target);
    current = parent;
  }
  return path.join(realpathSync(current), ...missing);
}

function isWithin(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

/** Throw unless `target` is below the temporary directory. The tests never touch a real home. */
export function assertThrowaway(target: string): void {
  const resolved = realish(target);
  const temp = realpathSync(tmpdir());
  if (!isWithin(resolved, temp)) {
    throw new Error(`refusing to touch ${resolved}: tests only ever write below ${temp}`);
  }
}

/** A temporary root directory. Removed by `cleanupThrowaways`. */
export async function makeThrowawayRoot(): Promise<string> {
  const root = await mkdtemp(path.join(realpathSync(tmpdir()), "resume-from-cc-"));
  createdRoots.push(root);
  return root;
}

/** A throwaway agent home, for example <tmp>/xxxx/.claude or <tmp>/xxxx/.claude-team. */
export async function makeThrowawayHome(basename = ".claude"): Promise<string> {
  const root = await makeThrowawayRoot();
  const home = path.join(root, basename);
  assertThrowaway(home);
  await mkdir(path.join(home, "projects"), { recursive: true });
  return home;
}

export async function cleanupThrowaways(): Promise<void> {
  for (const root of createdRoots.splice(0)) {
    assertThrowaway(root);
    await rm(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The live home. docs/tech-stack.md is normative: the live tests use a home the user
// authenticated once, out of band; they never create it, never log in, and never read a
// credential — not ~/.claude.json, not the Keychain, not an account reference copied from
// anywhere. A suite that authenticated itself would do so on every machine that later
// checks out this repository.
// ---------------------------------------------------------------------------

export const LIVE_HOME_ENV = "RESUME_FROM_LIVE_CLAUDE_HOME";
export const LIVE_HOME_BASENAME = ".resume-from-live-home";

/** The live home: `$RESUME_FROM_LIVE_CLAUDE_HOME`, else `$HOME/.resume-from-live-home`. */
export function resolveLiveClaudeHome(): string {
  const configured = process.env[LIVE_HOME_ENV];
  const home = realish(
    configured !== undefined && configured !== ""
      ? configured
      : path.join(homedir(), LIVE_HOME_BASENAME),
  );
  // The live home is still a throwaway. Pointed at a real store it would put C-3 back.
  const user = realish(homedir());
  if (home === user || isWithin(user, home) || path.basename(home) === ".claude") {
    throw new Error(`${LIVE_HOME_ENV}=${home} names a real home: it must be a throwaway`);
  }
  return home;
}

/** Throw unless `target` is inside the live home. The second interlock, beside C-3's first. */
export function assertLiveHome(target: string): void {
  const home = resolveLiveClaudeHome();
  const resolved = realish(target);
  if (!isWithin(resolved, home)) {
    throw new Error(`refusing to touch ${resolved}: live tests only ever write below ${home}`);
  }
}

export interface LiveClaudeHome {
  home: string;
  /** True only when the home exists and an installed Claude Code answers in it. */
  ready: boolean;
  /** Why the live tests skip, naming the one-time login. Empty when ready. */
  reason: string;
}

let probed: LiveClaudeHome | undefined;

/**
 * Is the live home usable? Detected without reading any credential: a trivial `claude -p`
 * runs in it, and a non-zero exit or a "Not logged in" answer means not authenticated.
 * Probed once per process.
 */
export function liveClaudeHome(): LiveClaudeHome {
  probed ??= probeLiveClaudeHome();
  return probed;
}

function probeLiveClaudeHome(): LiveClaudeHome {
  const home = resolveLiveClaudeHome();
  const skip = (detail: string): LiveClaudeHome => ({
    home,
    ready: false,
    reason:
      `${detail}. Log in once, out of band, then re-run:\n` +
      `  CLAUDE_CONFIG_DIR="${home}" claude\n` +
      "  RESUME_FROM_LIVE=1 pnpm vitest run src/adapters/claude-code\n" +
      "These tests never create that home and never read a credential.",
  });

  if (!existsSync(home)) return skip(`the live Claude Code home ${home} does not exist`);

  // A throwaway working directory: the probe must not key a session to this repository.
  const cwd = mkdtempSync(path.join(realpathSync(tmpdir()), "resume-from-cc-probe-"));
  createdRoots.push(cwd);
  const run = spawnSync("claude", ["-p", "Reply with the single word READY and nothing else."], {
    cwd,
    env: { ...process.env, CLAUDE_CONFIG_DIR: home },
    encoding: "utf8",
    timeout: 120_000,
  });

  if (run.error !== undefined) return skip(`claude could not be run: ${run.error.message}`);
  const said = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (run.status !== 0 || /not logged in/i.test(said)) {
    return skip(`the live Claude Code home ${home} is not authenticated`);
  }
  return { home, ready: true, reason: "" };
}

/**
 * The commit `src/import/landing/` performs. Refuses an existing path, as FR-49 requires.
 * `guard` is the write interlock: `assertThrowaway` by default, `assertLiveHome` for a live test.
 */
export async function commitPendingFiles(
  files: PendingFile[],
  guard: (target: string) => void = assertThrowaway,
): Promise<void> {
  for (const file of files) {
    guard(file.absolutePath);
    if (existsSync(file.absolutePath)) {
      throw new Error(`refusing to overwrite ${file.absolutePath}`);
    }
    await mkdir(path.dirname(file.absolutePath), { recursive: true });
    await writeFile(file.absolutePath, file.bytes);
  }
}

export async function writeFileIn(target: string, contents: string): Promise<void> {
  assertThrowaway(target);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
}

/** Write a fixture session file into a throwaway home. Returns its absolute path. */
export async function writeSessionFile(
  home: string,
  repoPath: string,
  id: string,
  entries: unknown[],
  options: { truncate?: boolean } = {},
): Promise<string> {
  const target = sessionFilePath(home, repoPath, id);
  let text = `${chainEntries(entries)
    .map((entry) => JSON.stringify(entry))
    .join("\n")}\n`;
  if (options.truncate === true) {
    text = text.slice(0, text.length - 12);
  }
  await writeFileIn(target, text);
  return target;
}

/** Give fixture records the same append-only parent chain Claude writes. */
export function chainEntries(entries: unknown[]): unknown[] {
  let previousUuid: string | null = null;
  return entries.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const entry = { ...(value as Record<string, unknown>) };
    if (typeof entry.uuid !== "string" || entry.uuid === "") return entry;
    if (entry.parentUuid === null || entry.parentUuid === undefined) {
      entry.parentUuid = previousUuid;
    }
    previousUuid = entry.uuid;
    return entry;
  });
}

/** sha256 of every file below `dir`, keyed by path relative to `dir`. */
export async function checksumTree(dir: string): Promise<Map<string, string>> {
  const sums = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else if (item.isFile()) {
        const bytes = await readFile(full);
        sums.set(path.relative(dir, full), createHash("sha256").update(bytes).digest("hex"));
      }
    }
  }
  if (existsSync(dir)) await walk(dir);
  return sums;
}

// ---------------------------------------------------------------------------
// Claude Code entry builders. They mirror the shape a real session file holds.
// ---------------------------------------------------------------------------

export interface EntryContext {
  cwd: string;
  gitBranch: string;
  sessionId: string;
}

interface Envelope extends Record<string, unknown> {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
  uuid: string;
  timestamp: string;
}

function envelope(ctx: EntryContext, uuid: string, timestamp: string): Envelope {
  return {
    parentUuid: null,
    isSidechain: false,
    userType: "external",
    cwd: ctx.cwd,
    sessionId: ctx.sessionId,
    version: "2.1.220",
    gitBranch: ctx.gitBranch,
    uuid,
    timestamp,
  };
}

export function userEntry(
  ctx: EntryContext,
  uuid: string,
  timestamp: string,
  text: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...envelope(ctx, uuid, timestamp),
    type: "user",
    message: { role: "user", content: text },
    ...extra,
  };
}

export function assistantTextEntry(
  ctx: EntryContext,
  uuid: string,
  timestamp: string,
  text: string,
): Record<string, unknown> {
  return {
    ...envelope(ctx, uuid, timestamp),
    type: "assistant",
    requestId: `req_${uuid.slice(0, 8)}`,
    message: {
      id: `msg_${uuid.slice(0, 8)}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-4",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  };
}

export function assistantToolUseEntry(
  ctx: EntryContext,
  uuid: string,
  timestamp: string,
  toolUseId: string,
  name: string,
  input: Record<string, unknown>,
  thinking?: string,
): Record<string, unknown> {
  const content: Record<string, unknown>[] = [];
  if (thinking !== undefined) content.push({ type: "thinking", thinking, signature: "sig" });
  content.push({ type: "tool_use", id: toolUseId, name, input });
  return {
    ...envelope(ctx, uuid, timestamp),
    type: "assistant",
    message: {
      id: `msg_${uuid.slice(0, 8)}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-4",
      content,
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  };
}

export function toolResultEntry(
  ctx: EntryContext,
  uuid: string,
  timestamp: string,
  toolUseId: string,
  body: string,
  isError = false,
): Record<string, unknown> {
  return {
    ...envelope(ctx, uuid, timestamp),
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: body,
          is_error: isError,
        },
      ],
    },
    toolUseResult: { stdout: body },
  };
}

export function summaryEntry(
  ctx: EntryContext,
  uuid: string,
  timestamp: string,
  summary: string,
): Record<string, unknown> {
  return {
    ...envelope(ctx, uuid, timestamp),
    type: "summary",
    summary,
    leafUuid: uuid,
  };
}

export function systemEntry(
  ctx: EntryContext,
  uuid: string,
  timestamp: string,
  content: string,
): Record<string, unknown> {
  return {
    ...envelope(ctx, uuid, timestamp),
    type: "system",
    subtype: "local_command",
    level: "info",
    isMeta: true,
    content,
  };
}

export function unknownTypeEntry(
  type: string,
  payload: Record<string, unknown> = {},
): Record<string, unknown> {
  return { type, ...payload };
}

/** A small, well-formed session: two messages, one Read call, one summary. */
export function referenceEntries(ctx: EntryContext, resultBody: string): Record<string, unknown>[] {
  return [
    userEntry(ctx, uuidFor(1), "2026-08-01T09:14:02.000Z", "make the auth token refresh work"),
    assistantTextEntry(
      ctx,
      uuidFor(2),
      "2026-08-01T09:14:05.000Z",
      "I'll look at how the token is stored first.",
    ),
    assistantToolUseEntry(
      ctx,
      uuidFor(3),
      "2026-08-01T09:14:06.000Z",
      "toolu_01",
      "Read",
      { file_path: "src/auth.ts" },
      "the user wants the refresh path checked",
    ),
    toolResultEntry(ctx, uuidFor(4), "2026-08-01T09:14:07.000Z", "toolu_01", resultBody),
    assistantTextEntry(
      ctx,
      uuidFor(5),
      "2026-08-01T09:14:20.000Z",
      "The refresh never persists the new token.",
    ),
    summaryEntry(
      ctx,
      uuidFor(6),
      "2026-08-01T09:15:40.000Z",
      "Fixed the write path; one test still fails.",
    ),
  ];
}

/** Stable, readable uuids for fixture entries. */
export function uuidFor(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function randomSessionId(): string {
  return randomUUID();
}

/** A body of `count` lines that no test may ever find in a canonical session. */
export function bodyOfLines(count: number, marker: string): string {
  return Array.from({ length: count }, (_, i) => `${marker} line ${i + 1}`).join("\n");
}
