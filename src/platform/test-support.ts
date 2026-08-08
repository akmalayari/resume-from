/**
 * Static-analysis helpers for this module's tests. `src/platform/` has no behaviour of its own:
 * its tests are checks of the boundary rule over the four submodule folders, so they read source
 * from disk and assert on what is really there.
 *
 * Source is read with `node:fs` and parsed with the stable TypeScript 6 compiler-API alias. The
 * TypeScript 7 AST API is unstable, and syntax is the only way to distinguish types, properties,
 * calls, and strings. Test support only: nothing here creates a file.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-compiler-api";
import type { ConfigLoader, HomeEntry } from "./config/contract.js";
import type { RepoReader } from "./repo/contract.js";
import type { CommitHandle, FileCommitter } from "./store/contract.js";
import type { EstimatorFactory, EstimatorFamily } from "./tokens/contract.js";

// `resolve` drops the trailing separator, so path containment compares whole segments.
export const PLATFORM_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
export const SRC_DIR = resolve(PLATFORM_DIR, "..");

/** The four generic services. The order is the order of the table in module.md. */
export const SUBMODULES = ["config", "repo", "tokens", "store"] as const;
export type Submodule = (typeof SUBMODULES)[number];

/** The trees whose vocabulary is the product's, and which no platform service may know. */
export const PRODUCT_TREES = ["session", "adapters", "import", "host"] as const;

export const submoduleDir = (name: Submodule): string => join(PLATFORM_DIR, name);

export interface Source {
  /** Absolute path. */
  path: string;
  text: string;
  ast: ts.SourceFile;
}

export function parseSource(path: string, text: string): Source {
  return {
    path,
    text,
    ast: ts.createSourceFile(path, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS),
  };
}

/**
 * Test files and test-only helpers. `*.test.ts` is the runner's convention (vitest.config.ts);
 * `test-support.ts` and `fixtures.ts` are the repository's name for a helper a test imports.
 */
export function isTestFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf(sep) + 1);
  return name.endsWith(".test.ts") || name === "test-support.ts" || name === "fixtures.ts";
}

export interface ReadOptions {
  /** Include `*.test.ts` and test-only helpers. Default true. */
  tests?: boolean;
  /** Directories to skip, absolute. */
  skip?: readonly string[];
}

/** Every `.ts` file under `dir`, recursively, parsed. */
export function readSources(dir: string, options: ReadOptions = {}): Source[] {
  const includeTests = options.tests ?? true;
  const skip = options.skip ?? [];
  const found: Source[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skip.includes(full)) continue;
      found.push(...readSources(full, options));
    } else if (entry.name.endsWith(".ts") && (includeTests || !isTestFile(full))) {
      found.push(parseSource(full, readFileSync(full, "utf8")));
    }
  }
  return found;
}

export interface ImportRecord {
  /** The specifier exactly as written. */
  specifier: string;
  /** Symbols pulled in by name. Empty for a namespace import, a bare side-effect import or a
   *  `export * from`. A default import is recorded as `default`. */
  names: string[];
}

type Bindings = ts.ImportClause | ts.NamedImportBindings | ts.NamedExportBindings;

function bindingNames(clause: Bindings | undefined): string[] {
  if (clause === undefined) return [];
  if (ts.isNamedImports(clause) || ts.isNamedExports(clause)) {
    return clause.elements.map((element) => (element.propertyName ?? element.name).text);
  }
  if (ts.isNamespaceImport(clause) || ts.isNamespaceExport(clause)) return [];
  const names: string[] = [];
  if (clause.name !== undefined) names.push("default");
  if (clause.namedBindings !== undefined) names.push(...bindingNames(clause.namedBindings));
  return names;
}

const literalText = (node: ts.Expression | undefined): string | undefined =>
  node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;

/** Every module specifier the file names: static, re-exported, dynamic, `require` and `import()`. */
export function imports(source: Source): ImportRecord[] {
  const found: ImportRecord[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = literalText(node.moduleSpecifier);
      if (specifier !== undefined)
        found.push({ specifier, names: bindingNames(node.importClause) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const specifier = literalText(node.moduleSpecifier);
      if (specifier !== undefined)
        found.push({ specifier, names: bindingNames(node.exportClause) });
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteralLike(argument.literal)) {
        found.push({ specifier: argument.literal.text, names: [] });
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamic =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require");
      const specifier = literalText(node.arguments[0]);
      if (isDynamic && specifier !== undefined) found.push({ specifier, names: [] });
    }
    ts.forEachChild(node, walk);
  };
  walk(source.ast);
  return found;
}

/** A relative specifier as an absolute path, with the `.js` extension left as written. */
export function resolveSpecifier(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  return resolve(dirname(fromFile), specifier);
}

export const isInside = (path: string, dir: string): boolean =>
  path === dir || path.startsWith(dir + sep);

/** Every name used in a type position: `Promise<ImportConfig>` yields both. */
export function typeReferences(node: ts.Node): string[] {
  const names: string[] = [];
  const walk = (current: ts.Node): void => {
    if (ts.isTypeReferenceNode(current)) names.push(current.typeName.getText());
    if (ts.isExpressionWithTypeArguments(current) && ts.isIdentifier(current.expression)) {
      names.push(current.expression.text);
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return names;
}

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Top-level declarations the file exports, plus its `export … from` re-exports. */
export function exportedStatements(source: Source): ts.Statement[] {
  return source.ast.statements.filter(
    (statement) => isExported(statement) || ts.isExportDeclaration(statement),
  );
}

export interface ExportedValue {
  name: string;
  /** Declared return type of a function, or declared type of a constant. */
  declaredType: string | undefined;
  isClass: boolean;
  /** Interfaces an exported class declares it implements. */
  implemented: string[];
}

/** Exported functions, constants and classes — the values a consumer could name. */
export function exportedValues(source: Source): ExportedValue[] {
  const values: ExportedValue[] = [];
  for (const statement of source.ast.statements) {
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      values.push({
        name: statement.name.text,
        declaredType: statement.type?.getText(),
        isClass: false,
        implemented: [],
      });
    } else if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      const implemented = (statement.heritageClauses ?? [])
        .filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
        .flatMap((clause) => clause.types.map((type) => type.expression.getText()));
      values.push({
        name: statement.name.text,
        declaredType: undefined,
        isClass: true,
        implemented,
      });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        const returnType =
          initializer !== undefined &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
            ? initializer.type?.getText()
            : undefined;
        values.push({
          name: declaration.name.text,
          declaredType: declaration.type?.getText() ?? returnType,
          isClass: false,
          implemented: [],
        });
      }
    }
  }
  return values;
}

/**
 * The name of every function this file calls: `writeFile(x)` and `fs.promises.writeFile(x)` both
 * yield `writeFile`. A name inside a string or a comment is not a call and is not returned.
 */
export function callNames(source: Source): { name: string; line: number }[] {
  const calls: { name: string; line: number }[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (name !== undefined) {
        const { line } = source.ast.getLineAndCharacterOfPosition(node.getStart(source.ast));
        calls.push({ name, line: line + 1 });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(source.ast);
  return calls;
}

/**
 * Local names bound to a `node:fs` export, so `import { writeFile as wf }` cannot hide a write
 * behind a rename. Maps the local name back to the name it was imported under.
 */
export function fsAliases(source: Source): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const statement of source.ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = literalText(statement.moduleSpecifier);
    if (specifier !== "node:fs" && specifier !== "node:fs/promises") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      aliases.set(element.name.text, (element.propertyName ?? element.name).text);
    }
  }
  return aliases;
}

/** A restatement marker: `<!-- contract: A, B — restated from src/x/module.md (subset: …) -->`. */
export interface RestatementMarker {
  /** Path of the document the marker appears in. */
  document: string;
  types: string[];
  /** The document cited as the normative home. */
  source: string;
}

/**
 * The marker comment, and only it. Prose that happens to use the word "restated" is not a
 * marker — `src/platform/store/module.md` has such a sentence about `src/adapters/`.
 */
const MARKER = /<!--\s*contract:\s*([^—]+)—\s*restated from\s+(\S+)/g;

export function parseRestatementMarkers(text: string, document: string): RestatementMarker[] {
  return [...text.matchAll(MARKER)].map((match) => ({
    document,
    types: (match[1] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    source: match[2] ?? "",
  }));
}

export function restatementMarkers(document: string): RestatementMarker[] {
  return parseRestatementMarkers(readFileSync(document, "utf8"), document);
}

/** Names of the interfaces a file exports — the shapes a consumer can be handed. */
export function exportedInterfaces(source: Source): string[] {
  return source.ast.statements
    .filter(
      (statement): statement is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(statement) && isExported(statement),
    )
    .map((statement) => statement.name.text);
}

/** Names of the types a file exports: interfaces and aliases alike. */
export function exportedTypeNames(source: Source): string[] {
  return source.ast.statements.flatMap((statement) =>
    (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
    isExported(statement)
      ? [statement.name.text]
      : [],
  );
}

/** Everything a file exports by name, whether declared here or re-exported from elsewhere. */
export function exportedNames(source: Source): string[] {
  const names: string[] = [];
  for (const statement of source.ast.statements) {
    if (ts.isExportDeclaration(statement)) {
      names.push(...bindingNames(statement.exportClause));
    } else if (isExported(statement)) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
        }
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement)) &&
        statement.name !== undefined
      ) {
        names.push(statement.name.text);
      }
    }
  }
  return names;
}

/**
 * The four services as a consumer receives them: interfaces only, never a concrete type.
 * `src/host/` is the module that will build these; here they are whatever the test supplies.
 */
export interface PlatformServices {
  config: ConfigLoader;
  repo: RepoReader;
  tokens: EstimatorFactory;
  store: FileCommitter;
}

export interface ImportWork {
  /** Distinguishes one run's files from the other's. */
  name: string;
  /** Directory the run reads git state from and creates its files under. */
  dir: string;
  family: EstimatorFamily;
  text: string;
}

export interface ImportOutcome {
  budgetShare: number;
  extraHomes: HomeEntry[];
  repoRoot: string | null;
  tokens: number;
  handle: CommitHandle;
}

/**
 * A consumer of all four services, written against their interfaces alone. It stands in for the
 * pipeline `src/import/` will be: this module may not import that tree, so the shape of the work
 * is imitated here — load settings, read git, price some text, create files.
 */
export async function runImport(
  services: PlatformServices,
  work: ImportWork,
): Promise<ImportOutcome> {
  const config = await services.config.load();
  const identity = await services.repo.identify(work.dir);
  const tokens = services.tokens.forFamily(work.family).estimate(work.text);
  const files = [
    {
      absolutePath: join(work.dir, "landed", `${work.name}.json`),
      bytes: Buffer.from(`{"run":"${work.name}"}`, "utf8"),
    },
  ];
  const handle = await services.store.commit(work.dir, files);
  return {
    budgetShare: config.budgetShare,
    extraHomes: config.extraHomes,
    repoRoot: identity.root,
    tokens,
    handle,
  };
}
