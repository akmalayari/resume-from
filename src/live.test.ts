/**
 * T-ROO-13 — the acceptance test of docs/requirements.md, run against installed agents.
 *
 * It needs a real codex-cli and a real Pi, and it builds its own throwaway homes; it never reads
 * or writes a real agent home (docs/tech-stack.md, C-3). Gated:
 *
 *   RESUME_FROM_LIVE=1 pnpm vitest run src/live.test.ts
 *
 * What it mechanizes: a Codex session of more than twenty turns holding file reads and edits,
 * seen by the installed Codex itself; then `/resume-from` run through the composed system into a
 * throwaway Pi home; then the landed session opened by Pi's own session manager, so what is
 * asserted is what Pi will put in front of the model — not what this repository wrote.
 *
 * What it cannot mechanize is the last line of the scenario: typing the next instruction and
 * seeing the agent continue without being told anything again. That needs a real turn against a
 * real model, and it is the by-hand step the plan keeps for release.
 */

import { execFileSync, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AgentAdapter,
  AgentId,
  CanonicalSession,
  CanonicalTurn,
  HomePath,
} from "./host/contract.js";
import {
  agentOf,
  type Bench,
  bench,
  cleanupTempDirs,
  fileList,
  REPO_ROOT,
  seedSession,
} from "./test-support.js";

const live = process.env.RESUME_FROM_LIVE === "1";

const FIRST_REQUEST = "make the auth token refresh work";
const LAST_ANSWER = "the refresh path now retries once before it gives up";
const TURNS = 22;

/** A stand-in for Pi's command context: a live one exists only inside Pi itself (C-10). */
const fakePiRuntime = (cwd: string, home: HomePath): unknown => ({
  cwd,
  home,
  switchSession(_path: string, options: { withSession: () => void }) {
    options.withSession();
    return Promise.resolve({ cancelled: false });
  },
});

/** More than twenty turns, with file reads, an edit, a summary and a final answer. */
function workedSession(): CanonicalSession {
  const turns: CanonicalTurn[] = [
    {
      index: 0,
      role: "user",
      kind: "message",
      text: FIRST_REQUEST,
      toolCall: null,
      timestamp: "2026-08-01T09:00:00Z",
    },
  ];

  for (let step = 1; step < TURNS - 1; step += 1) {
    const stamp = new Date(Date.UTC(2026, 7, 1, 9, step)).toISOString();
    if (step % 3 === 1) {
      turns.push({
        index: step,
        role: "agent",
        kind: "tool-call",
        text: "",
        toolCall: {
          toolName: "Read",
          argumentsText: `'src/auth/token-${step}.ts'`,
          outcomeLine: `Read('src/auth/token-${step}.ts') → 120 lines`,
          effect: "read-only",
          bodyDropped: true,
        },
        timestamp: stamp,
      });
    } else if (step % 3 === 2) {
      turns.push({
        index: step,
        role: "agent",
        kind: "tool-call",
        text: "",
        toolCall: {
          toolName: "Edit",
          argumentsText: `'src/auth/token-${step - 1}.ts'`,
          outcomeLine: `Edit('src/auth/token-${step - 1}.ts') → 1 change`,
          effect: "mutating",
          bodyDropped: false,
        },
        timestamp: stamp,
      });
    } else {
      turns.push({
        index: step,
        role: step % 6 === 0 ? "user" : "agent",
        kind: "message",
        text:
          step % 6 === 0
            ? "keep going, and do not touch the retry budget"
            : `the token store is read in token-${step - 1}.ts and refreshed too late`,
        toolCall: null,
        timestamp: stamp,
      });
    }
  }

  turns.push({
    index: TURNS - 1,
    role: "agent",
    kind: "message",
    text: LAST_ANSWER,
    toolCall: null,
    timestamp: "2026-08-01T09:30:00Z",
  });

  return {
    provenance: {
      ref: { agent: "codex", home: "/seed", id: "01JQ8Z3K7M4N5P6Q7R8S9T0V1W" },
      title: FIRST_REQUEST,
      startedAt: "2026-08-01T09:00:00Z",
      updatedAt: "2026-08-01T09:30:00Z",
      repo: {
        commit: null,
        branch: "main",
        changedPaths: ["src/auth/token-1.ts"],
      },
    },
    turns,
  };
}

interface JsonRpcCall {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

/**
 * The installed codex-cli, driven over stdio JSON-RPC and pointed at a throwaway home. This is
 * how the test asks Codex itself whether the seeded session is one of its own. `src/adapters/
 * codex/` has a helper of the same shape; it lives in that module's folder, so this is this
 * module's own.
 */
async function codexAppServer(
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

  return await new Promise((settle, fail) => {
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`codex app-server did not answer within ${timeoutMs}ms`));
    }, timeoutMs);
    const finish = (): void => {
      clearTimeout(timer);
      child.kill();
      settle(results);
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
        const message = JSON.parse(line) as {
          id?: number;
          result?: Record<string, unknown>;
        };
        if (typeof message.id === "number" && wanted.has(message.id)) {
          results.set(message.id, message.result ?? {});
          wanted.delete(message.id);
          if (wanted.size === 0) finish();
        }
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
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

/** The installed Pi package root, found through the `pi` binary on PATH. */
function findPiPackage(): string | null {
  try {
    const binary = execFileSync("/usr/bin/env", ["which", "pi"], {
      encoding: "utf8",
    }).trim();
    if (binary === "") return null;
    // <package>/dist/cli.js
    return resolve(dirname(realpathSync(binary)), "..");
  } catch {
    return null;
  }
}

interface PiSessionManagerModule {
  SessionManager: {
    open(
      path: string,
      sessionDir?: string,
      cwdOverride?: string,
    ): {
      buildSessionContext(): { messages: { role: string; content: unknown }[] };
    };
    list(cwd: string, sessionDir?: string): Promise<{ path: string; id: string }[]>;
  };
}

describe.skipIf(!live)("T-ROO-13 — live: the acceptance test", () => {
  let scene: Bench;
  let codexHome: HomePath;
  let sourceId = "";
  let source: AgentAdapter;
  let piTarget: AgentAdapter;

  const isCodex = (adapter: AgentAdapter): boolean => adapter.capabilities().agent === "codex";

  beforeAll(async () => {
    scene = await bench({ seed: false });

    // The source is the agent the requirements name: the one that cannot host a picker and keeps
    // its threads under its own home. The target is the one that switches in process (C-10).
    const bySelection = (level: string): AgentAdapter | undefined =>
      scene.host
        .registry()
        .all()
        .find((adapter) => adapter.capabilities().selection === level);

    const chosen =
      scene.host.registry().sources().filter(isCodex)[0] ?? scene.host.registry().sources()[0];
    if (chosen === undefined) throw new Error("the agent list holds no source adapter");
    source = chosen;
    piTarget = bySelection("interactive-picker") ?? chosen;

    codexHome = source.capabilities().defaultHome;
    sourceId = await seedSession(source, codexHome, workedSession());
  }, 120_000);

  afterAll(async () => {
    scene?.guard.restore();
    await cleanupTempDirs();
  });

  it("the source is a session the installed Codex itself lists and resumes (C-8)", async () => {
    const answers = await codexAppServer(codexHome, [
      { id: 1, method: "thread/list", params: {} },
      { id: 2, method: "thread/resume", params: { threadId: sourceId } },
    ]);

    interface Thread {
      id: string;
      preview: string;
      turns: {
        items: { type: string; text?: string; content?: { text: string }[] }[];
      }[];
    }
    const threads = (answers.get(1)?.data ?? []) as Thread[];
    const listed = threads.find((thread) => thread.id === sourceId);
    expect(listed, "the seeded thread must be in Codex's own list").toBeDefined();
    expect(listed?.preview).toBe(FIRST_REQUEST);

    const resumed = answers.get(2)?.thread as Thread | undefined;
    expect(resumed).toBeDefined();
    const items = (resumed?.turns ?? []).flatMap((turn) => turn.items);
    expect(items.length).toBeGreaterThanOrEqual(TURNS);
  }, 120_000);

  it("holds more than twenty turns, with file reads and edits", async () => {
    const rows = await source.listSessions(codexHome);
    const row = rows.find((candidate) => candidate.ref.id === sourceId);
    expect(row).toBeDefined();
    if (row === undefined) return;

    const loaded = await source.loadSession(row);
    expect(loaded.turns.length).toBeGreaterThanOrEqual(20);
    // Tool names are never translated (FR-27), so the read and the edit are recognisable by
    // name. They are looked for in the session as a whole rather than in `toolCall` alone: what
    // a target agent's own format can hold is that agent's business, and Codex records a
    // synthesized call as a written line (C-7, C-8). What matters to the scenario is that the
    // work the session did is still legible in it.
    const written = JSON.stringify(loaded);
    expect(written).toContain("Read(");
    expect(written).toContain("Edit(");
  }, 60_000);

  it("/resume-from lands it in Pi, and Pi's own loader gives the turns to the model", async () => {
    const agent: AgentId = agentOf(piTarget);
    const profile = scene.host
      .profiles()
      .build(agent, join(scene.root, "pi-landing"), scene.host.config());
    const pipeline = await scene.host.pipelineFor(profile);
    const request = {
      repoRoot: REPO_ROOT,
      target: profile,
      selection: { by: "session-id" as const, id: sourceId },
      onlyAgent: agentOf(source),
      onlyHome: codexHome,
    };

    const report = await pipeline.preview(request);
    expect([report.blocked, report.blockedReason]).toEqual([false, null]);
    expect(report.lines.join("\n")).toContain(FIRST_REQUEST);

    // The preview is confirmed. Only now is anything written (FR-20).
    const result = await pipeline.commit(
      request,
      fakePiRuntime(REPO_ROOT, profile.home),
      report.confirmationToken,
    );
    expect(result.itemsStored).toBe(result.itemsSent);

    const piPackage = findPiPackage();
    expect(piPackage, "an installed Pi is needed for this test").not.toBeNull();
    if (piPackage === null) return;

    const module = (await import(
      join(piPackage, "dist", "core", "session-manager.js")
    )) as PiSessionManagerModule;
    // Pi keeps its sessions in a directory of its own inside the home. The landing does not say
    // where, and this module may not know a file layout, so the file is found by the identifier
    // the landing did return.
    const landedFile = (await fileList(profile.home))
      .map((name) => join(profile.home, name))
      .find((path) => path.includes(result.ref.id));
    expect(landedFile, "the landed session file must exist in the throwaway home").toBeDefined();
    // expect() above throws on undefined; this narrows the type for the compiler.
    if (landedFile === undefined) throw new Error("unreachable: expect above would have thrown");
    const sessionDir = dirname(landedFile);

    const listed = await module.SessionManager.list(REPO_ROOT, sessionDir);
    expect(listed.map((entry) => entry.id)).toContain(result.ref.id);

    const context = module.SessionManager.open(
      landedFile,
      sessionDir,
      REPO_ROOT,
    ).buildSessionContext();
    const said = JSON.stringify(context.messages);
    expect(said).toContain(FIRST_REQUEST);
    expect(said).toContain(LAST_ANSWER);
  }, 180_000);

  // The last line of the scenario — type the next instruction and watch the agent continue
  // without being told anything again — is a real turn against a real model. It is run by hand
  // before release (docs/plans/2026-08-04-implement-resume-from.md, Post-Completion).
  // cannot be automated — needs a live model call and human verification
  it.todo("the agent continues the task and the user explains nothing again — run by hand");
});
