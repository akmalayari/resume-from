/**
 * T-PLA-7 and T-PLA-8 — the two boundaries this module owns: only `src/platform/store/` creates a
 * file, and no service keeps state that two imports could share.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { createConfigLoader } from "./config/index.js";
import { createRepoReader } from "./repo/index.js";
import { createFileCommitter } from "./store/index.js";
import {
  callNames,
  fsAliases,
  imports,
  isInside,
  isTestFile,
  type PlatformServices,
  PRODUCT_TREES,
  parseSource,
  readSources,
  resolveSpecifier,
  runImport,
  type Source,
  SRC_DIR,
  submoduleDir,
} from "./test-support.js";
import { createEstimatorFactory } from "./tokens/index.js";

describe("T-PLA-7 src/platform/store/ is the only writer in the tree", () => {
  /**
   * Every primitive that can bring a path into existence. Names, not text: this list is a set of
   * strings, so the scan below cannot find itself. Spawning a process is out of scope — the one
   * module that spawns anything is `src/platform/repo/`, and T-REP-11 covers that it runs only
   * read-only git.
   */
  const FILE_CREATING = new Set([
    "appendFile",
    "appendFileSync",
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
    "open",
    "openSync",
    "rename",
    "renameSync",
    "symlink",
    "symlinkSync",
    "writeFile",
    "writeFileSync",
  ]);

  const storeDir = submoduleDir("store");

  /**
   * Runtime source only. docs/tech-stack.md: "only `src/platform/store/` may create files at
   * runtime." A test that builds a throwaway home is not a write path of the tool, which is why
   * the last check here forbids runtime code from importing a test helper.
   */
  const runtimeSources = (): Source[] => readSources(SRC_DIR, { tests: false });

  function writes(source: Source): string[] {
    const aliases = fsAliases(source);
    return callNames(source)
      .filter((call) => FILE_CREATING.has(aliases.get(call.name) ?? call.name))
      .map((call) => `${source.path}:${call.line} ${call.name}`);
  }

  it("no file outside the store creates a file", () => {
    const sources = runtimeSources().filter((source) => !isInside(source.path, storeDir));

    // A walk that stopped early would pass this test without having looked anywhere.
    for (const tree of [...PRODUCT_TREES, "platform"]) {
      const reached = sources.some((source) => isInside(source.path, join(SRC_DIR, tree)));
      expect(reached, `the scan never reached src/${tree}/`).toBe(true);
    }

    expect(sources.flatMap(writes)).toEqual([]);
  });

  it("the store does create files, so the scan is looking for something real", () => {
    const inStore = readSources(storeDir, { tests: false });

    expect(inStore.flatMap(writes).length).toBeGreaterThan(0);
  });

  it("the scan sees a write in another module", () => {
    const sample = parseSource(
      join(SRC_DIR, "import", "landing", "sample.ts"),
      [
        'import { writeFile as save } from "node:fs/promises";',
        "export const land = (path: string) => save(path, Buffer.alloc(0));",
      ].join("\n"),
    );

    expect(writes(sample)).toHaveLength(1);
  });

  /** The file a specifier names: `./x.js` is emitted from `./x.ts`. */
  const asSourceFile = (target: string): string =>
    target.endsWith(".js") ? `${target.slice(0, -3)}.ts` : `${target}.ts`;

  it("no runtime file imports a test helper, so the scan cannot be side-stepped", () => {
    const smuggled = runtimeSources().flatMap((source) =>
      imports(source)
        .map((record) => ({
          record,
          target: resolveSpecifier(source.path, record.specifier),
        }))
        .filter(({ target }) => target !== undefined && isTestFile(asSourceFile(target)))
        .map(({ record }) => `${source.path}: ${record.specifier}`),
    );

    expect(smuggled).toEqual([]);
  });
});

describe("T-PLA-8 no service holds shared mutable state", () => {
  const run = promisify(execFile);
  const temporary: string[] = [];

  afterAll(async () => {
    await Promise.all(temporary.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  /** A throwaway directory, resolved because macOS reaches the temporary root by symlink. */
  async function temporaryDir(name: string): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), `resume-from-platform-${name}-`)));
    temporary.push(dir);
    return dir;
  }

  const exists = async (path: string): Promise<boolean> =>
    await stat(path).then(
      () => true,
      () => false,
    );

  it("two imports sharing all four services do not see each other's data", async () => {
    const first = await temporaryDir("first");
    const second = await temporaryDir("second");
    // One repository and one plain directory, so the two runs must get different answers.
    await run("git", ["init", "-q", first]);

    const settings = await temporaryDir("settings");
    const configPath = join(settings, "config.json");
    await writeFile(configPath, JSON.stringify({ budgetShare: 0.42 }), "utf8");

    // One instance of each service, shared by both runs — the composition root builds one set.
    const services: PlatformServices = {
      config: createConfigLoader({ configPath }),
      repo: createRepoReader(first),
      tokens: createEstimatorFactory(),
      store: createFileCommitter(),
    };

    const work = {
      first: {
        name: "first",
        dir: first,
        family: "gpt",
        text: "a".repeat(400),
      },
      second: { name: "second", dir: second, family: "claude", text: "hello" },
    } as const;

    const alone = {
      first: await runImport(services, {
        ...work.first,
        dir: await temporaryDir("alone-first"),
      }),
      second: await runImport(services, {
        ...work.second,
        dir: await temporaryDir("alone-second"),
      }),
    };

    const [a, b] = await Promise.all([
      runImport(services, work.first),
      runImport(services, work.second),
    ]);

    // Correct: concurrently is the same answer as alone, for everything the directory does not fix.
    expect(a.tokens).toBe(alone.first.tokens);
    expect(b.tokens).toBe(alone.second.tokens);
    expect(a.tokens).not.toBe(b.tokens);
    expect(a.budgetShare).toBe(0.42);
    expect(b.budgetShare).toBe(0.42);
    expect(a.repoRoot).toBe(first);
    expect(b.repoRoot).toBeNull();

    // Isolated: each run created its own files, under its own directory, with its own bytes.
    expect(a.handle.createdPaths).toHaveLength(1);
    expect(b.handle.createdPaths).toHaveLength(1);
    expect(a.handle.createdPaths.every((path) => isInside(path, first))).toBe(true);
    expect(b.handle.createdPaths.every((path) => isInside(path, second))).toBe(true);
    for (const path of a.handle.createdPaths) {
      expect(await readFile(path, "utf8")).toContain('"run":"first"');
    }

    // The settings each run received are its own object: one run cannot edit the other's.
    expect(a.extraHomes).toEqual([]);
    a.extraHomes.push({ agent: "pi", home: "/tmp/elsewhere" });
    expect(b.extraHomes).toEqual([]);
    expect((await services.config.load()).extraHomes).toEqual([]);

    // The handle reports its paths but deliberately exposes no pathname deletion operation.
    expect("rollback" in a.handle).toBe(false);
    for (const path of a.handle.createdPaths) expect(await exists(path)).toBe(true);
    for (const path of b.handle.createdPaths) expect(await exists(path)).toBe(true);
  });

  it("one estimator instance counts concurrent texts independently", async () => {
    const factory = createEstimatorFactory();
    const estimator = factory.forFamily("gpt");
    const texts = ["", "one", "a much longer sentence, with punctuation", "🙂".repeat(50)];

    const alone = texts.map((text) => estimator.estimate(text));
    const together = await Promise.all(
      texts.map(async (text) => {
        await Promise.resolve();
        return estimator.estimate(text);
      }),
    );

    expect(together).toEqual(alone);
  });
});
