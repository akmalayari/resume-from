/**
 * T-ROO-8 to T-ROO-12 — the constraints that hold for the whole tree.
 *
 * Each of these is a rule the design says is structural rather than disciplinary: there is one
 * write path because only one module calls a write, no tool result body can survive because the
 * type has nowhere to put one, no rule can branch on an agent because no rule may name one, and
 * no secret can cross because nothing in the vocabulary can hold one.
 *
 * They read the source and parse it, so a name inside a string or a comment is never mistaken for
 * a call or a field.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  bench,
  callNames,
  cleanupTempDirs,
  fsCalls,
  importRequest,
  importSpecifiers,
  interfaceMembers,
  isInside,
  parseSource,
  readSources,
  repoRelative,
  SRC_DIR,
  shippedSources,
  stringLiterals,
  unionMembers,
} from "./test-support.js";

const STORE_DIR = join(SRC_DIR, "platform", "store");
const REPO_MODULE_DIR = join(SRC_DIR, "platform", "repo");
const IMPORT_DIR = join(SRC_DIR, "import");
const SESSION_CONTRACT = join(SRC_DIR, "session", "contract.ts");
const ADAPTERS_CONTRACT = join(SRC_DIR, "adapters", "contract.ts");

const shipped = shippedSources();

const sourceAt = (path: string) => parseSource(path, readFileSync(path, "utf8"));

describe("T-ROO-8 — there is exactly one write path", () => {
  /**
   * Every `node:fs` primitive that can bring a file or a directory into existence, change one, or
   * remove one. Reads are not here: reading a source session is what the tool does (FR-8).
   */
  const WRITES = new Set([
    "appendFile",
    "appendFileSync",
    "chmod",
    "chmodSync",
    "copyFile",
    "copyFileSync",
    "cp",
    "cpSync",
    "createWriteStream",
    "link",
    "linkSync",
    "mkdir",
    "mkdirSync",
    "mkdtemp",
    "mkdtempSync",
    "rename",
    "renameSync",
    "rm",
    "rmSync",
    "rmdir",
    "rmdirSync",
    "symlink",
    "symlinkSync",
    "truncate",
    "truncateSync",
    "unlink",
    "unlinkSync",
    "utimes",
    "utimesSync",
    "writeFile",
    "writeFileSync",
  ]);

  const writers = shipped
    .map((source) => ({ path: source.path, hits: fsCalls(source, WRITES) }))
    .filter((file) => file.hits.length > 0);

  it("finds the writes it is looking for", () => {
    // A test that found nothing would pass for the wrong reason: the tool does write files.
    expect(writers.length).toBeGreaterThan(0);
  });

  it("every one of them is inside src/platform/store/ (FR-49, FR-53, C-3)", () => {
    const outside = writers
      .filter((file) => !isInside(file.path, STORE_DIR))
      .map((file) => `${repoRelative(file.path)}: ${file.hits.map((hit) => hit.name).join(", ")}`);
    expect(outside).toEqual([]);
  });

  it("no other module can reach a shell to write with either", () => {
    // `src/platform/repo/` spawns git, and passes an argument array rather than a shell string
    // (docs/tech-stack.md). Every other module has no way to run a process at all.
    const spawners = shipped
      .filter((source) =>
        importSpecifiers(source).some((specifier) => specifier.startsWith("node:child_process")),
      )
      .map((source) => repoRelative(source.path));
    expect(spawners.every((path) => path.startsWith(repoRelative(REPO_MODULE_DIR)))).toBe(true);
  });

  it("the adapters return files instead of writing them (Decision 2)", () => {
    const adapters = shipped.filter((source) => isInside(source.path, join(SRC_DIR, "adapters")));
    expect(adapters.length).toBeGreaterThan(3);
    for (const source of adapters) {
      const writes = fsCalls(source, WRITES).map((call) => call.name);
      // Reading is allowed and necessary (FR-8); writing is not reachable from here.
      expect([repoRelative(source.path), writes]).toEqual([repoRelative(source.path), []]);
    }
  });
});

describe("T-ROO-9 — there is no field for a tool result body", () => {
  const members = interfaceMembers(sourceAt(SESSION_CONTRACT)).filter(
    (member) => member.owner === "ToolCallRecord",
  );

  it("holds exactly the six fields the design names", () => {
    expect(members.map((member) => member.name).sort()).toEqual([
      "argumentsText",
      "bodyDropped",
      "effect",
      "outcomeLine",
      "resultRecorded",
      "toolName",
    ]);
  });

  it("has no field a result body could be kept in", () => {
    // `bodyDropped` names a body it does not hold: it is the boolean that says one was thrown
    // away (FR-25). A field that could keep content is one whose type can hold content.
    const suspicious = members
      .filter((member) =>
        /result|body|output|content|stdout|stderr|payload|response|data|raw/i.test(member.name),
      )
      .filter((member) => member.type !== "boolean");
    expect(suspicious.map((member) => `${member.name}: ${member.type}`)).toEqual([]);
  });

  it("has no field open enough to hold one (FR-24, FR-60)", () => {
    // A field typed `unknown`, `any`, `object`, or an index signature would be a place to put a
    // body back. The outcome is one line of text, and the fact of the drop is a boolean.
    for (const member of members) {
      expect([member.name, member.type]).not.toContain("any");
      expect([member.name, member.type]).not.toContain("unknown");
      expect(member.name).not.toBe("[index signature]");
      expect(member.type).not.toMatch(/\[key: |Record<|object|\bunknown\b|\bany\b/);
    }
    expect(members.find((member) => member.name === "outcomeLine")?.type).toBe("string");
    expect(members.find((member) => member.name === "bodyDropped")?.type).toBe("boolean");
  });

  it("is the only place a turn can carry a tool call", () => {
    const turn = interfaceMembers(sourceAt(SESSION_CONTRACT)).filter(
      (member) => member.owner === "CanonicalTurn",
    );
    expect(turn.find((member) => member.name === "toolCall")?.type).toBe("ToolCallRecord | null");
    expect(turn.find((member) => member.name === "text")?.type).toBe("string");
  });
});

describe("T-ROO-10 — no rule branches on an agent name", () => {
  const names = unionMembers(sourceAt(SESSION_CONTRACT), "AgentId");

  it("knows which names it is looking for", () => {
    expect(names.length).toBeGreaterThan(1);
  });

  it("no file in src/import/ holds an agent name (FR-60)", () => {
    const hits = shipped
      .filter((source) => isInside(source.path, IMPORT_DIR))
      .flatMap((source) =>
        stringLiterals(source)
          .filter((literal) => names.includes(literal.text))
          .map((literal) => `${repoRelative(source.path)}:${literal.line}`),
      );
    expect(hits).toEqual([]);
  });

  it("no rule switches or compares on the agent of anything", () => {
    const branches = shipped
      .filter((source) => isInside(source.path, IMPORT_DIR))
      .flatMap((source) => {
        const found: string[] = [];
        const text = source.text;
        // A comparison against a literal agent name cannot exist without the literal, which the
        // test above already forbids. What remains is a branch on the *field*, which is how a
        // rule would reintroduce per-agent behaviour through a variable.
        const pattern = /switch\s*\(\s*[^)]*\bagent\b[^)]*\)/g;
        for (const match of text.matchAll(pattern))
          found.push(`${repoRelative(source.path)}: ${match[0]}`);
        return found;
      });
    expect(branches).toEqual([]);
  });

  it("a per-agent fact is read from a capability instead", () => {
    // FR-60's positive half: the rules do consult what an agent can do — through the declared
    // capability, which is a value, not a name.
    const reading = shipped
      .filter((source) => isInside(source.path, IMPORT_DIR))
      .filter((source) => /capabilities\(\)/.test(source.text));
    expect(reading.length).toBeGreaterThan(0);
  });
});

describe("T-ROO-11 — no model is ever called", () => {
  const NETWORK_MODULES = [
    "node:http",
    "node:https",
    "node:http2",
    "node:net",
    "node:tls",
    "node:dgram",
    "undici",
    "axios",
    "node-fetch",
  ];

  it("no shipped file imports a network module (FR-8)", () => {
    const reaching = shipped.flatMap((source) =>
      importSpecifiers(source)
        .filter((specifier) => NETWORK_MODULES.includes(specifier))
        .map((specifier) => `${repoRelative(source.path)} → ${specifier}`),
    );
    expect(reaching).toEqual([]);
  });

  it("no shipped file calls fetch, a socket or a websocket", () => {
    const CALLS = new Set(["fetch", "WebSocket", "XMLHttpRequest", "EventSource", "connect"]);
    const calls = shipped.flatMap((source) =>
      callNames(source)
        .filter((call) => CALLS.has(call.name))
        .map((call) => `${repoRelative(source.path)}:${call.line} ${call.name}`),
    );
    expect(calls).toEqual([]);
  });

  it("a whole import runs with every fetch throwing", async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("T-ROO-11: no module in this tree may call a model");
    }) as typeof globalThis.fetch;

    try {
      const scene = await bench();
      const [source] = [...scene.seeded.keys()];
      const [adapter] = scene.host.registry().targets();
      expect(source).toBeDefined();
      expect(adapter).toBeDefined();
      if (source === undefined || adapter === undefined) return;

      const target = scene.host
        .profiles()
        .build(adapter.capabilities().agent, null, scene.host.config());
      const pipeline = await scene.host.pipelineFor(target);
      const report = await pipeline.preview(importRequest(scene, source, target));

      expect(report.blocked).toBe(false);
      expect(report.lines.length).toBeGreaterThan(0);
      scene.guard.restore();
    } finally {
      globalThis.fetch = previous;
    }
  }, 60_000);

  afterAll(async () => {
    await cleanupTempDirs();
  });
});

describe("T-ROO-12 — no secret has a representation", () => {
  /**
   * The concepts FR-28, NG-7 and NG-8 keep out of the tree. Matched against field names, not
   * prose: `windowTokens` is a budget, not a credential, so "token" alone is not a concept here.
   */
  const FORBIDDEN: [string, RegExp][] = [
    ["a password", /pass(word|phrase)/i],
    ["a secret", /secret/i],
    ["a credential", /credential/i],
    ["an API key", /api[_-]?key|\bkey\b/i],
    ["an access token", /(access|auth|refresh|bearer|session)[_-]?token/i],
    ["an authorization header", /authorization|bearer/i],
    ["a cookie", /cookie/i],
    ["an environment value", /^env|environment/i],
    ["a system prompt", /system[_-]?prompt|instructions/i],
    ["hidden reasoning", /reasoning|thinking|thought|scratchpad/i],
    ["vendor state", /vendor|internal[_-]?state|opaque/i],
  ];

  const vocabulary = [
    ...interfaceMembers(sourceAt(SESSION_CONTRACT)),
    ...interfaceMembers(sourceAt(ADAPTERS_CONTRACT)),
  ];

  it("has fields to check", () => {
    expect(vocabulary.filter((member) => !member.isMethod).length).toBeGreaterThan(30);
  });

  it.each(FORBIDDEN)("has no field for %s", (_concept, pattern) => {
    const found = vocabulary
      .filter((member) => !member.isMethod)
      .filter((member) => pattern.test(member.name))
      .map((member) => `${member.owner}.${member.name}`);
    expect(found).toEqual([]);
  });

  it("has no field open enough to carry one", () => {
    // A `Record<string, unknown>` or an index signature in the canonical model would be a place
    // for a vendor's own state to ride along (NG-8).
    const open = vocabulary
      .filter((member) => !member.isMethod)
      .filter(
        (member) =>
          /\bunknown\b|\bany\b|Record<|\[key: /.test(member.type) ||
          member.name === "[index signature]",
      )
      .map((member) => `${member.owner}.${member.name}: ${member.type}`);
    expect(open).toEqual([]);
  });

  it("the one opaque handle is a parameter, never something the model keeps", () => {
    // `AgentRuntime` is `unknown` on purpose: it is the live context an adapter is handed. It is
    // passed in and never stored, so it is a method parameter in the port and a field nowhere.
    const carriers = vocabulary
      .filter((member) => !member.isMethod)
      .filter((member) => /AgentRuntime/.test(member.type));
    expect(carriers).toEqual([]);

    const port = readSources(join(SRC_DIR, "adapters")).find(
      (file) => file.path === ADAPTERS_CONTRACT,
    );
    expect(port?.text).toMatch(/runtime: AgentRuntime/);
  });
});
