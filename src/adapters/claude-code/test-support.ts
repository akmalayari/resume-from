/**
 * Helpers the tests of this module share.
 *
 * Every write goes through `assertThrowaway`, which refuses any path outside the
 * temporary directory. C-3 says a bad write can damage the user's real sessions, so the
 * interlock is a hard failure rather than a convention: if `mkdtemp` or an environment
 * variable ever silently fails, this is what stops a write into ~/.claude.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

/** Throw unless `target` is below the temporary directory. The tests never touch a real home. */
export function assertThrowaway(target: string): void {
  const resolved = realish(target);
  const temp = realpathSync(tmpdir());
  if (resolved !== temp && !resolved.startsWith(`${temp}${path.sep}`)) {
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

/** The commit `src/import/landing/` performs. Refuses an existing path, as FR-49 requires. */
export async function commitPendingFiles(files: PendingFile[]): Promise<void> {
  for (const file of files) {
    assertThrowaway(file.absolutePath);
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
  let text = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  if (options.truncate === true) {
    text = text.slice(0, text.length - 12);
  }
  await writeFileIn(target, text);
  return target;
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
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: body, is_error: isError }],
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
