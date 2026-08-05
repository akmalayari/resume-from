/**
 * Live tests. They need an installed Pi (0.83.0 or later) and build their own throwaway
 * home; they never read or write a real Pi home (docs/tech-stack.md, C-3).
 *
 *   RESUME_FROM_LIVE=1 pnpm vitest run src/adapters/pi
 *
 * They check the facts this module refuses to assume: where Pi keeps sessions, and what
 * Pi's own loader does with the file this module writes.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REFERENCE_SESSION } from "../../../test/fixtures/reference-session.js";
import { createPiAdapter } from "./adapter.js";
import type { PiSwitchContext, TargetProfile } from "./contract.js";
import { makeThrowawayHome, markerFixture } from "./fixtures.js";
import { MARKER_CUSTOM_TYPE } from "./format.js";

const live = process.env.RESUME_FROM_LIVE === "1";

/** The installed Pi package root, found through the `pi` binary on PATH. */
function findPiPackage(): string | null {
  try {
    const binary = execFileSync("/usr/bin/env", ["which", "pi"], { encoding: "utf8" }).trim();
    if (!binary) return null;
    // <package>/dist/cli.js
    return resolve(dirname(realpathSync(binary)), "..");
  } catch {
    return null;
  }
}

interface PiConfigModule {
  getAgentDir(): string;
}

interface PiSessionEntry {
  type: string;
  customType?: string;
  message?: { role: string; content: unknown };
}

interface PiSessionManager {
  getEntries(): PiSessionEntry[];
  getBranch(): PiSessionEntry[];
  buildSessionContext(): { messages: { role: string; content: unknown }[] };
}

interface PiSessionManagerModule {
  SessionManager: {
    open(path: string, sessionDir?: string, cwdOverride?: string): PiSessionManager;
    list(cwd: string, sessionDir?: string): Promise<{ path: string; id: string }[]>;
  };
}

const homes: string[] = [];
const REPO = "/tmp/resume-from-live-repo";

function throwawayHome(): string {
  const created = makeThrowawayHome();
  homes.push(created);
  return created;
}

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

function target(home: string): TargetProfile {
  return { agent: "pi", home, windowTokens: 200_000 };
}

/** Serialize the reference session and place it, the way `src/import/landing/` would. */
function importInto(home: string) {
  const adapter = createPiAdapter({ cwd: () => REPO });
  const serialized = adapter.serialize(REFERENCE_SESSION, target(home), markerFixture());
  expect(adapter.validate(serialized)).toEqual([]);
  for (const file of serialized.files) {
    mkdirSync(dirname(file.absolutePath), { recursive: true });
    writeFileSync(file.absolutePath, file.bytes);
  }
  const file = serialized.files[0];
  if (!file) throw new Error("no file to place");
  return { serialized, filePath: file.absolutePath, sessionDir: dirname(file.absolutePath) };
}

describe.skipIf(!live)("live: Pi 0.83.0 or later", () => {
  const piPackage = findPiPackage();

  it("finds the installed Pi", () => {
    expect(piPackage).toBeTruthy();
    expect(existsSync(join(piPackage ?? "", "dist", "config.js"))).toBe(true);
  });

  it("T-PI-15 — the default home is what Pi uses", async () => {
    if (!piPackage) throw new Error("no installed Pi");
    const config = (await import(join(piPackage, "dist", "config.js"))) as PiConfigModule;

    // Pi's own resolution, read without writing anything into it.
    expect(createPiAdapter().capabilities().defaultHome).toBe(config.getAgentDir());
  });

  it("T-PI-16 — the marker stays out of the model context", async () => {
    if (!piPackage) throw new Error("no installed Pi");
    const { SessionManager } = (await import(
      join(piPackage, "dist", "core", "session-manager.js")
    )) as PiSessionManagerModule;
    const home = throwawayHome();
    const placed = importInto(home);

    const session = SessionManager.open(placed.filePath, placed.sessionDir, REPO);
    const marker = session.getEntries().find((entry) => entry.customType === MARKER_CUSTOM_TYPE);
    expect(marker).toBeTruthy();

    const context = JSON.stringify(session.buildSessionContext().messages);
    for (const line of markerFixture().lines) {
      expect(context).not.toContain(line);
    }
    // The declaration must match reality: Pi does hold the marker, out of context.
    expect(createPiAdapter().capabilities().provenance).toBe("out-of-context-entry");
  });

  it("T-PI-17 — the C-10 scenario", async () => {
    if (!piPackage) throw new Error("no installed Pi");
    const { SessionManager } = (await import(
      join(piPackage, "dist", "core", "session-manager.js")
    )) as PiSessionManagerModule;
    const home = throwawayHome();
    const placed = importInto(home);

    // Pi's own loader turns the imported turns into native Pi messages.
    const session = SessionManager.open(placed.filePath, placed.sessionDir, REPO);
    const messages = session.buildSessionContext().messages;
    const roles = new Set(messages.map((message) => message.role));
    expect(roles.has("user")).toBe(true);
    expect(roles.has("assistant")).toBe(true);
    const rendered = JSON.stringify(messages);
    expect(rendered).toContain(REFERENCE_SESSION.turns[0]?.text ?? "");

    // The switch, from a command handler only (C-10). The screen half of C-10 —
    // the `Resumed session` marker — was measured by hand and is recorded in the
    // requirements; nothing here drives Pi's TUI.
    let activated = false;
    const commandContext: PiSwitchContext = {
      switchSession: async (path, options) => {
        activated = true;
        expect(path).toBe(placed.filePath);
        options.withSession();
        return { cancelled: false };
      },
    };
    const adapter = createPiAdapter();
    const outcome = await adapter.switchTo(home, placed.serialized.sessionId, commandContext);

    expect(outcome).toEqual({ switched: true, cancelled: false });
    expect(activated).toBe(true);
  });

  it("T-PI-18 — the imported turns are native", async () => {
    if (!piPackage) throw new Error("no installed Pi");
    const { SessionManager } = (await import(
      join(piPackage, "dist", "core", "session-manager.js")
    )) as PiSessionManagerModule;
    const home = throwawayHome();
    const placed = importInto(home);

    // Pi's own resume list, scoped to the throwaway home.
    const listed = await SessionManager.list(REPO, placed.sessionDir);
    expect(listed.map((info) => info.id)).toContain(placed.serialized.sessionId);

    // Pi's own scrollback: the branch from the leaf holds every imported turn.
    const session = SessionManager.open(placed.filePath, placed.sessionDir, REPO);
    const branch = session.getBranch();
    expect(branch.filter((entry) => entry.type === "message")).toHaveLength(
      REFERENCE_SESSION.turns.length,
    );
  });
});
