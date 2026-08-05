import { mkdir, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BUDGET_SHARE, DEFAULT_PINNED_RECENT_TURNS } from "./defaults.js";
import { createConfigLoader } from "./loader.js";
import { emptyConfigDir, removeTempDirs, writeConfigFile } from "./test-support.js";

afterEach(removeTempDirs);

describe("T-CFG-1 — a missing file yields the defaults", () => {
  it("resolves with every default and does not reject", async () => {
    const temp = await emptyConfigDir();
    const config = await createConfigLoader({ configPath: temp.path }).load();

    expect(config).toEqual({
      extraHomes: [],
      budgetShare: 0.3,
      pinnedRecentTurns: 5,
      windowOverrides: [],
    });
    expect(DEFAULT_BUDGET_SHARE).toBe(0.3);
    expect(DEFAULT_PINNED_RECENT_TURNS).toBe(5);
  });

  it("gives each load its own arrays, so one caller cannot mutate another's config", async () => {
    const temp = await emptyConfigDir();
    const loader = createConfigLoader({ configPath: temp.path });

    const first = await loader.load();
    const second = await loader.load();

    expect(first.extraHomes).not.toBe(second.extraHomes);
    expect(first.windowOverrides).not.toBe(second.windowOverrides);
  });
});

describe("T-CFG-2 — a partial file is completed with defaults", () => {
  it("keeps the set value and defaults every other field", async () => {
    const temp = await writeConfigFile({ budgetShare: 0.5 });

    const config = await createConfigLoader({ configPath: temp.path }).load();

    expect(config.budgetShare).toBe(0.5);
    expect(config.pinnedRecentTurns).toBe(DEFAULT_PINNED_RECENT_TURNS);
    expect(config.extraHomes).toEqual([]);
    expect(config.windowOverrides).toEqual([]);
    for (const value of Object.values(config)) expect(value).toBeDefined();
  });
});

describe("T-CFG-3 — extra homes are read", () => {
  it("returns every listed home with its agent", async () => {
    const temp = await writeConfigFile({
      extraHomes: [
        { agent: "claude-code", home: "~/.claude-team" },
        { agent: "pi", home: "/opt/pi-second-home" },
      ],
    });

    const config = await createConfigLoader({ configPath: temp.path }).load();

    expect(config.extraHomes).toEqual([
      { agent: "claude-code", home: resolve(homedir(), ".claude-team") },
      { agent: "pi", home: "/opt/pi-second-home" },
    ]);
  });
});

describe("T-CFG-4 — home paths are resolved to absolute", () => {
  it.each([
    [
      "a tilde path",
      "~/.resume-from-absent-home",
      () => resolve(homedir(), ".resume-from-absent-home"),
    ],
    ["a relative path", "homes/pi", (dir: string) => join(dir, "homes", "pi")],
    [
      "a path that climbs out with ..",
      "../pi-elsewhere",
      (dir: string) => resolve(dir, "..", "pi-elsewhere"),
    ],
    [
      "a path with .. inside it",
      "homes/../homes/codex",
      (dir: string) => join(dir, "homes", "codex"),
    ],
  ])("resolves %s", async (_label, raw, expected) => {
    const temp = await writeConfigFile({ extraHomes: [{ agent: "pi", home: raw }] });

    const config = await createConfigLoader({ configPath: temp.path }).load();

    expect(config.extraHomes[0]?.home).toBe(expected(temp.dir));
  });

  it("resolves a symlinked path to its target, so the search compares locations", async () => {
    const temp = await emptyConfigDir();
    const target = join(temp.dir, "real-home");
    const link = join(temp.dir, "linked-home");
    await mkdir(target);
    await symlink(target, link);
    const written = await writeConfigFile({ extraHomes: [{ agent: "pi", home: link }] });

    const config = await createConfigLoader({ configPath: written.path }).load();

    expect(config.extraHomes[0]?.home).toBe(target);
  });
});

describe("T-CFG-5 — window overrides are read", () => {
  it("returns the override keyed by agent", async () => {
    const temp = await writeConfigFile({
      windowOverrides: [{ agent: "claude-code", windowTokens: 500000 }],
    });

    const config = await createConfigLoader({ configPath: temp.path }).load();

    expect(config.windowOverrides).toEqual([{ agent: "claude-code", windowTokens: 500000 }]);
  });
});
