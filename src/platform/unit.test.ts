/**
 * T-PLA-1 to T-PLA-4 — the boundary rule of `src/platform/`, checked over the four submodule
 * folders as they are on disk. This module has no behaviour of its own; these are its tests.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  exportedStatements,
  exportedTypeNames,
  imports,
  isInside,
  PLATFORM_DIR,
  PRODUCT_TREES,
  parseRestatementMarkers,
  parseSource,
  readSources,
  resolveSpecifier,
  restatementMarkers,
  type Source,
  SRC_DIR,
  SUBMODULES,
  submoduleDir,
  typeReferences,
} from "./test-support.js";

const productDirs = PRODUCT_TREES.map((name) => join(SRC_DIR, name));

/** A bare specifier naming one of the product trees, in case a path mapping is ever added. */
const BARE_PRODUCT = new RegExp(`(?:^|/)(?:src/)?(?:${PRODUCT_TREES.join("|")})(?:/|$)`);

interface Violation {
  file: string;
  specifier: string;
  names: string[];
}

/** Every import in `source` that reaches into one of `dirs`. */
function importsInto(source: Source, dirs: readonly string[]): Violation[] {
  const found: Violation[] = [];
  for (const record of imports(source)) {
    const target = resolveSpecifier(source.path, record.specifier);
    const reaches =
      target === undefined
        ? !record.specifier.startsWith("node:") && BARE_PRODUCT.test(record.specifier)
        : dirs.some((dir) => isInside(target, dir));
    if (reaches)
      found.push({ file: source.path, specifier: record.specifier, names: record.names });
  }
  return found;
}

/** Written as a fragment so the sample is not itself an import of the tree it names. */
const sampleImport = (tree: string, symbols: string): Source =>
  parseSource(
    join(submoduleDir("repo"), "sample.ts"),
    `import type { ${symbols} } from ${JSON.stringify(`../../${tree}/contract.js`)};`,
  );

describe("T-PLA-1 no platform service imports the product's vocabulary", () => {
  const services = ["repo", "tokens", "store"] as const;

  it.each(services)("%s imports nothing from session, adapters, import or host", (name) => {
    const sources = readSources(submoduleDir(name));
    expect(sources.length).toBeGreaterThan(0);

    const found = sources.flatMap((source) => importsInto(source, productDirs));

    expect(found).toEqual([]);
  });

  it.each(PRODUCT_TREES)("the check sees an import of src/%s", (tree) => {
    expect(importsInto(sampleImport(tree, "Thing"), productDirs)).toHaveLength(1);
  });
});

describe("T-PLA-2 the config exception is exactly one type pair", () => {
  /** The one documented exception: settings are keyed by agent (src/platform/module.md). */
  const EXCEPTION = { module: join(SRC_DIR, "session"), types: ["AgentId", "HomePath"] };

  const outsidePlatform = (source: Source): Violation[] =>
    imports(source).flatMap((record) => {
      const target = resolveSpecifier(source.path, record.specifier);
      if (target === undefined || isInside(target, PLATFORM_DIR)) return [];
      return [{ file: source.path, specifier: record.specifier, names: record.names }];
    });

  it("imports AgentId and HomePath from src/session/, and nothing else from outside", () => {
    const sources = readSources(submoduleDir("config"));
    expect(sources.length).toBeGreaterThan(0);

    const crossings = sources.flatMap(outsidePlatform);

    for (const crossing of crossings) {
      const target = resolveSpecifier(crossing.file, crossing.specifier);
      expect(
        target === undefined ? "" : target,
        `${crossing.file}: ${crossing.specifier}`,
      ).toContain(EXCEPTION.module);
      expect([...crossing.names].sort(), `${crossing.file}: ${crossing.specifier}`).toEqual(
        EXCEPTION.types,
      );
    }
    // The exception is documented, so it must be exercised: a config that imported nothing at all
    // would pass the loop above without proving anything.
    expect(crossings).toHaveLength(1);
  });

  it("a third symbol from the same module fails", () => {
    const extra = sampleImport("session", "AgentId, HomePath, SessionId");
    const names = outsidePlatform({ ...extra, path: join(submoduleDir("config"), "sample.ts") });

    expect(names).toHaveLength(1);
    expect([...(names[0]?.names ?? [])].sort()).not.toEqual(EXCEPTION.types);
  });
});

describe("T-PLA-3 no restatement marker points at the product", () => {
  const documents = SUBMODULES.map((name) => join(submoduleDir(name), "module.md"));
  const markers = documents.flatMap((document) => restatementMarkers(document));

  it("every marker cites a module inside src/platform/, but for the config exception", () => {
    const exceptions = markers.filter((marker) => !marker.source.startsWith("src/platform/"));

    expect(exceptions).toEqual([
      {
        document: join(submoduleDir("config"), "module.md"),
        types: ["AgentId", "HomePath"],
        source: "src/session/module.md",
      },
    ]);
  });

  it("that is the only marker the four documents carry", () => {
    expect(markers).toHaveLength(1);
  });

  it("prose about a restatement is not a marker", () => {
    // src/platform/store/module.md says PendingFile "is restated by src/adapters/". That is a
    // sentence about a consumer, not a claim that this module restates the product's vocabulary.
    const store = join(submoduleDir("store"), "module.md");
    expect(readFileSync(store, "utf8")).toContain("restated by");
    expect(restatementMarkers(store)).toEqual([]);
  });

  it("the check sees a marker that cites the product", () => {
    const doc = "<!-- contract: CanonicalTurn — restated from src/session/module.md -->";
    const parsed = parseRestatementMarkers(doc, "sample.md");

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.source.startsWith("src/platform/")).toBe(false);
  });
});

describe("T-PLA-4 no service signature mentions a session", () => {
  /** The product's vocabulary. A service speaks bytes, text, paths, commits or settings. */
  const PRODUCT_WORDS = ["turn", "session", "descriptor", "plan", "capabilit"];
  const productWord = new RegExp(PRODUCT_WORDS.join("|"), "i");

  /** Names in a type position, plus the names of the exported types themselves. */
  const signatureTypes = (source: Source): string[] => [
    ...exportedTypeNames(source),
    ...exportedStatements(source).flatMap(typeReferences),
  ];

  it.each(SUBMODULES)("%s speaks no product vocabulary in its exported signatures", (name) => {
    const sources = readSources(submoduleDir(name), { tests: false });
    expect(sources.length).toBeGreaterThan(0);

    const offending = sources.flatMap((source) =>
      signatureTypes(source)
        .filter((type) => productWord.test(type))
        .map((type) => `${source.path}: ${type}`),
    );

    expect(offending).toEqual([]);
  });

  it("a property named after a turn count is a setting, not a product type", () => {
    // ImportConfig.pinnedRecentTurns is a number the user set. The rule is about types.
    const config = parseSource(
      join(submoduleDir("config"), "sample.ts"),
      "export interface ImportConfig { pinnedRecentTurns: number }",
    );

    expect(signatureTypes(config).filter((type) => productWord.test(type))).toEqual([]);
  });

  it.each(PRODUCT_WORDS)("the check sees a signature taking a %s type", (word) => {
    const type = `Canonical${word[0]?.toUpperCase()}${word.slice(1)}`;
    const sample = parseSource(
      join(submoduleDir("tokens"), "sample.ts"),
      `export interface Service { measure(input: ${type}): number }`,
    );

    expect(signatureTypes(sample).filter((name) => productWord.test(name))).toEqual([type]);
  });
});
