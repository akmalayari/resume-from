import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiAdapter } from "./adapter.js";
import type { AgentId, TargetProfile } from "./contract.js";
import {
  checksumTree,
  makeThrowawayHome,
  markerFixture,
  piAssistantTextDraft,
  piToolCallDraft,
  piToolResultDraft,
  piUserDraft,
  writeFixtureSession,
} from "./fixtures.js";

const homes: string[] = [];

function throwawayHome(): string {
  const created = makeThrowawayHome();
  homes.push(created);
  return created;
}

afterEach(() => {
  while (homes.length > 0) {
    const dir = homes.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const CWD = "/Users/testuser/Workspace/demo";
const AGENTS: AgentId[] = ["pi", "codex", "claude-code"];

describe("T-PI-12 — source files are byte-identical", () => {
  it("leaves the source home untouched when it feeds an import into each agent", async () => {
    const sourceHome = throwawayHome();
    writeFixtureSession(sourceHome, CWD, [
      piUserDraft("make the auth token refresh work"),
      piAssistantTextDraft("Looking at the token store."),
      piToolCallDraft("call-1", "read", { path: "src/auth.ts" }),
      piToolResultDraft("call-1", "read", "400 lines of file"),
    ]);
    const before = checksumTree(sourceHome);
    expect(before.size).toBeGreaterThan(0);
    const adapter = createPiAdapter({ cwd: () => CWD });

    for (const agent of AGENTS) {
      // The source role is the same work whatever the target is: list, load, and — when the
      // target is Pi as well — serialize. The other two targets are their own adapters' job.
      const [descriptor] = await adapter.listSessions(sourceHome);
      if (!descriptor) throw new Error("no descriptor listed");
      const canonical = await adapter.loadSession(descriptor);
      const target: TargetProfile = {
        agent,
        home: throwawayHome(),
        windowTokens: 200_000,
      };
      if (agent === "pi") adapter.serialize(canonical, target, markerFixture());
    }

    expect([...checksumTree(sourceHome).entries()]).toEqual([...before.entries()]);
  });

  it("never opens a source session for writing (NG-1, AC-4)", async () => {
    const sourceHome = throwawayHome();
    const written = writeFixtureSession(sourceHome, CWD, [piUserDraft("hi")]);
    const before = statSync(written.filePath).mtimeMs;
    const adapter = createPiAdapter({ cwd: () => CWD });

    const [descriptor] = await adapter.listSessions(sourceHome);
    if (!descriptor) throw new Error("no descriptor listed");
    await adapter.loadSession(descriptor);

    expect(statSync(written.filePath).mtimeMs).toBe(before);
    expect(readFileSync(written.filePath, "utf8")).toBe(written.text);
  });
});

describe("T-PI-20 — the switch is only ever called from a command handler", () => {
  const srcRoot = resolve(import.meta.dirname, "..", "..");
  const piModule = join(srcRoot, "adapters", "pi");
  const piExtension = join(srcRoot, "host", "pi-extension");

  function sourceFiles(root: string): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name === "node_modules" || name === "dist") continue;
          walk(full);
          continue;
        }
        if (full.endsWith(".ts") && !full.endsWith(".test.ts")) found.push(full);
      }
    };
    walk(root);
    return found;
  }

  it("has Pi's own switchSession called from this module and the Pi extension only", () => {
    const callers = sourceFiles(srcRoot).filter((file) =>
      /\bswitchSession\s*\(/.test(readFileSync(file, "utf8")),
    );
    const stray = callers.filter(
      (file) => !file.startsWith(`${piModule}/`) && !file.startsWith(`${piExtension}/`),
    );

    expect(stray.map((file) => relative(srcRoot, file))).toEqual([]);
  });

  it("has no adapter calling switchTo — the landing owns that call (FR-43)", () => {
    const callers = sourceFiles(join(srcRoot, "adapters")).filter((file) =>
      /\.switchTo\s*\(/.test(readFileSync(file, "utf8")),
    );

    expect(callers.map((file) => relative(srcRoot, file))).toEqual([]);
  });

  it("never reaches into the host, so it cannot register an event handler (C-10)", () => {
    for (const file of sourceFiles(piModule)) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/from\s+"\.\.\/\.\.\/host\//);
      expect(text).not.toMatch(/\bon\(["'](?:message|turn|event)/);
    }
  });
});
