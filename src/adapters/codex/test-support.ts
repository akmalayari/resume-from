/**
 * Test helpers for this module only. Not part of the adapter's surface.
 *
 * Deliberately not named `*.test.ts`: Vitest collects `src/**\/*.test.ts`, and this file
 * holds no tests of its own.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import type { RolloutEntry } from "./rollout.js";
import {
  CODEX_ENTRY_EVENT_MSG,
  CODEX_ENTRY_RESPONSE_ITEM,
  CODEX_ENTRY_SESSION_META,
  CODEX_EVENT_AGENT_MESSAGE,
  CODEX_EVENT_USER_MESSAGE,
  rolloutFilePath,
} from "./rollout.js";

const TS = "2026-08-01T09:14:02.000Z";

export function metaEntry(sessionId: string, over: Record<string, unknown> = {}): RolloutEntry {
  return {
    timestamp: TS,
    type: CODEX_ENTRY_SESSION_META,
    payload: {
      id: sessionId,
      session_id: sessionId,
      timestamp: TS,
      cwd: "/repo/demo",
      originator: "codex-tui",
      cli_version: "0.146.0",
      source: "cli",
      thread_source: "user",
      model_provider: "openai",
      git: {
        commit_hash: "d68d5097e6a304724cf75f5faf92a8945a1e0785",
        branch: "main",
        repository_url: "git@example.com:demo/demo.git",
      },
      ...over,
    },
  };
}

export function userEvent(message: string, timestamp = TS): RolloutEntry {
  return {
    timestamp,
    type: CODEX_ENTRY_EVENT_MSG,
    payload: {
      type: CODEX_EVENT_USER_MESSAGE,
      message,
      images: [],
      local_images: [],
      text_elements: [],
    },
  };
}

export function agentEvent(message: string, timestamp = TS): RolloutEntry {
  return {
    timestamp,
    type: CODEX_ENTRY_EVENT_MSG,
    payload: {
      type: CODEX_EVENT_AGENT_MESSAGE,
      message,
      phase: "commentary",
      memory_citation: null,
    },
  };
}

/** Encrypted reasoning, exactly as codex-cli 0.146.0 records it (C-4). */
export function reasoningItem(encrypted: string, timestamp = TS): RolloutEntry {
  return {
    timestamp,
    type: CODEX_ENTRY_RESPONSE_ITEM,
    payload: {
      type: "reasoning",
      id: "rs_0000",
      summary: [{ type: "summary_text", text: "**Thinking about the token refresh**" }],
      encrypted_content: encrypted,
    },
  };
}

export function reasoningEvent(text: string, timestamp = TS): RolloutEntry {
  return {
    timestamp,
    type: CODEX_ENTRY_EVENT_MSG,
    payload: { type: "agent_reasoning", text },
  };
}

export function functionCall(
  name: string,
  argumentsText: string,
  callId: string,
  timestamp = TS,
): RolloutEntry {
  return {
    timestamp,
    type: CODEX_ENTRY_RESPONSE_ITEM,
    payload: {
      type: "function_call",
      id: `fc_${callId}`,
      name,
      arguments: argumentsText,
      call_id: callId,
    },
  };
}

export function functionCallOutput(callId: string, output: string, timestamp = TS): RolloutEntry {
  return {
    timestamp,
    type: CODEX_ENTRY_RESPONSE_ITEM,
    payload: { type: "function_call_output", call_id: callId, output },
  };
}

export function tokenCountEvent(timestamp = TS): RolloutEntry {
  return {
    timestamp,
    type: CODEX_ENTRY_EVENT_MSG,
    payload: { type: "token_count", info: { total_token_usage: { total_tokens: 1 } } },
  };
}

export function unknownEntry(timestamp = TS): RolloutEntry {
  return { timestamp, type: "sparkle_entry", payload: { anything: true } };
}

export function serializeEntries(entries: RolloutEntry[]): string {
  return entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

export function makeTempHome(prefix = "codex-home-"): string {
  // realpath because macOS hands out /var/... while Codex reports /private/var/...
  const home = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  mkdirSync(join(home, "sessions"), { recursive: true });
  writeFileSync(join(home, "config.toml"), "");
  return home;
}

/** Writes a rollout file the way Codex lays them out. Tests may write; the adapter may not. */
export function writeRollout(
  home: string,
  sessionId: string,
  entries: RolloutEntry[],
  at = new Date(TS),
  transform: (text: string) => string = (text) => text,
): string {
  const path = rolloutFilePath(home, sessionId, at);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, transform(serializeEntries(entries)));
  return path;
}

/** Absolute paths of every file under a directory, sorted. */
export function walk(dir: string): string[] {
  const out: string[] = [];
  const visit = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(full);
    }
  };
  visit(dir);
  return out;
}

/** Content checksum of a whole tree: relative path plus bytes of every file. */
export function checksumTree(dir: string): string {
  const hash = createHash("sha256");
  for (const file of walk(dir)) {
    hash.update(relative(dir, file).split(sep).join("/"));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

/* ------------------------------------------------------------------ *
 * Live-only: the codex app-server, driven over stdio JSON-RPC.
 * Used by the tests gated behind RESUME_FROM_LIVE=1. It talks to an
 * installed codex-cli pointed at a throwaway CODEX_HOME, never a real one.
 * ------------------------------------------------------------------ */

export interface JsonRpcCall {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

export async function appServer(
  home: string,
  calls: JsonRpcCall[],
  timeoutMs = 30_000,
): Promise<Map<number, Record<string, unknown>>> {
  const child = spawn("codex", ["app-server"], {
    env: { ...process.env, CODEX_HOME: home },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const results = new Map<number, Record<string, unknown>>();
  const wanted = new Set(calls.map((call) => call.id));
  wanted.add(0);

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`codex app-server did not answer within ${timeoutMs}ms`));
    }, timeoutMs);
    const finish = (): void => {
      clearTimeout(timer);
      child.kill();
      resolve(results);
    };

    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let cut = buffer.indexOf("\n");
      while (cut >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        cut = buffer.indexOf("\n");
        if (line === "") continue;
        const message = JSON.parse(line) as { id?: number; result?: Record<string, unknown> };
        if (typeof message.id === "number" && wanted.has(message.id)) {
          results.set(message.id, message.result ?? {});
          wanted.delete(message.id);
          if (wanted.size === 0) finish();
        }
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    const send = (message: object): void => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    };
    send({
      id: 0,
      method: "initialize",
      params: { clientInfo: { name: "resume-from", version: "0" } },
    });
    send({ method: "initialized", params: {} });
    for (const call of calls) send(call);
  });
}
