/**
 * T-PLA-9 — every service is reachable through its interface alone. Each of the four is replaced
 * by a stub with different behaviour, and the consumer takes it without knowing.
 *
 * The end-to-end half of this test — the whole pipeline running with each service stubbed — is
 * T-ROO-22, because it needs `src/import/` and `src/host/`, which this module may not import.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConfigLoader } from "./config/contract.js";
import { createConfigLoader } from "./config/index.js";
import type { RepoReader } from "./repo/contract.js";
import { createRepoReader } from "./repo/index.js";
import type { CommitHandle, FileCommitter, PendingFile } from "./store/contract.js";
import { createFileCommitter } from "./store/index.js";
import {
  type ImportOutcome,
  imports,
  isInside,
  PLATFORM_DIR,
  type PlatformServices,
  readSources,
  resolveSpecifier,
  runImport,
} from "./test-support.js";
import type { EstimatorFactory } from "./tokens/contract.js";
import { createEstimatorFactory } from "./tokens/index.js";

const run = promisify(execFile);
const temporary: string[] = [];

async function temporaryDir(name: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `resume-from-stub-${name}-`)));
  temporary.push(dir);
  return dir;
}

const exists = async (path: string): Promise<boolean> =>
  await stat(path).then(
    () => true,
    () => false,
  );

/** A fixed count, whatever the text. */
const STUB_TOKENS = 7;
const stubEstimators: EstimatorFactory = {
  forFamily: () => ({ estimate: () => STUB_TOKENS }),
};

/** A repository reader that knows nothing: no root, no head, no distance. */
const stubRepo: RepoReader = {
  identify: () => Promise.resolve({ root: null, head: null, branch: null }),
  distanceFrom: () => Promise.resolve({ known: false, ahead: 0, behind: 0 }),
};

/** Settings no default produces. */
const STUB_SHARE = 0.9;
const stubConfig: ConfigLoader = {
  load: () =>
    Promise.resolve({
      extraHomes: [{ agent: "codex" as const, home: "/stub/home" }],
      budgetShare: STUB_SHARE,
      pinnedRecentTurns: 11,
      windowOverrides: [],
    }),
};

/** A committer that records what it was asked to create, and creates nothing. */
function recordingCommitter(): {
  store: FileCommitter;
  asked: PendingFile[][];
} {
  const asked: PendingFile[][] = [];
  const store: FileCommitter = {
    commit: (_root: string, files: PendingFile[]): Promise<CommitHandle> => {
      asked.push(files);
      return Promise.resolve({
        createdPaths: files.map((file) => file.absolutePath),
      });
    },
  };
  return { store, asked };
}

let real: PlatformServices;
let repository: string;

beforeAll(async () => {
  repository = await temporaryDir("repo");
  await run("git", ["init", "-q", repository]);
  const settings = await temporaryDir("settings");
  const configPath = join(settings, "config.json");
  await writeFile(configPath, JSON.stringify({ budgetShare: 0.25 }), "utf8");

  real = {
    config: createConfigLoader({ configPath }),
    repo: createRepoReader(repository),
    tokens: createEstimatorFactory(),
    store: createFileCommitter(),
  };
});

afterAll(async () => {
  await Promise.all(temporary.map((dir) => rm(dir, { recursive: true, force: true })));
});

const work = (dir: string) =>
  ({
    name: "run",
    dir,
    family: "gpt",
    text: "some text worth counting",
  }) as const;

/** A fresh working directory inside the repository, so every run lands somewhere of its own. */
async function repoWorkdir(name: string): Promise<string> {
  const dir = join(repository, name);
  await mkdir(dir);
  return dir;
}

describe("T-PLA-9 every service is reachable through its interface alone", () => {
  it("all four real, as the baseline the stubs are compared against", async () => {
    const outcome = await runImport(real, work(await repoWorkdir("baseline")));

    expect(outcome.budgetShare).toBe(0.25);
    expect(outcome.repoRoot).toBe(repository);
    expect(outcome.tokens).toBeGreaterThan(0);
    expect(outcome.tokens).not.toBe(STUB_TOKENS);
    expect(await exists(outcome.handle.createdPaths[0] ?? "")).toBe(true);
  });

  interface Swap {
    service: string;
    swap: () => PlatformServices;
    check: (outcome: ImportOutcome) => Promise<void> | void;
  }

  const swaps: Swap[] = [
    {
      service: "tokens",
      swap: () => ({ ...real, tokens: stubEstimators }),
      check: (outcome) => {
        expect(outcome.tokens).toBe(STUB_TOKENS);
        // The three real services still answered.
        expect(outcome.budgetShare).toBe(0.25);
        expect(outcome.repoRoot).toBe(repository);
      },
    },
    {
      service: "repo",
      swap: () => ({ ...real, repo: stubRepo }),
      check: (outcome) => {
        expect(outcome.repoRoot).toBeNull();
        expect(outcome.tokens).toBeGreaterThan(0);
      },
    },
    {
      service: "config",
      swap: () => ({ ...real, config: stubConfig }),
      check: (outcome) => {
        expect(outcome.budgetShare).toBe(STUB_SHARE);
        expect(outcome.extraHomes).toEqual([{ agent: "codex", home: "/stub/home" }]);
      },
    },
    {
      service: "store",
      swap: () => ({ ...real, store: recordingCommitter().store }),
      check: async (outcome) => {
        expect(outcome.handle.createdPaths).toHaveLength(1);
        for (const path of outcome.handle.createdPaths) expect(await exists(path)).toBe(false);
      },
    },
  ];

  it.each(swaps)("$service can be replaced by a stub", async ({ service, swap, check }) => {
    const outcome = await runImport(swap(), work(await repoWorkdir(`stubbed-${service}`)));

    await check(outcome);
  });

  it("the recording committer is asked for the files it never creates", async () => {
    const { store, asked } = recordingCommitter();
    const dir = await temporaryDir("recorded");

    await runImport({ ...real, store }, work(dir));

    expect(asked).toHaveLength(1);
    expect(asked[0]?.map((file) => file.absolutePath)).toEqual([join(dir, "landed", "run.json")]);
    expect(await exists(join(dir, "landed"))).toBe(false);
  });

  it("nothing outside src/platform/ was needed to make the stubs work", () => {
    const own = readSources(PLATFORM_DIR, {
      skip: (["config", "repo", "tokens", "store"] as const).map((name) =>
        join(PLATFORM_DIR, name),
      ),
    });
    expect(own.length).toBeGreaterThan(0);

    const outside = own.flatMap((source) =>
      imports(source)
        .map((record) => ({
          record,
          target: resolveSpecifier(source.path, record.specifier),
        }))
        .filter(({ target }) => target !== undefined && !isInside(target, PLATFORM_DIR))
        .map(({ record }) => `${source.path}: ${record.specifier}`),
    );

    expect(outside).toEqual([]);
  });
});
