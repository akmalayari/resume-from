import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const version = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).version;

const packages = [
  {
    name: "resume-from",
    directory: repoRoot,
    expected: [
      "package.json",
      "dist/bin.js",
      "dist/host/pi-extension/index.js",
      "shims/pi/extensions/resume-from.js",
    ],
  },
  {
    name: "@alexeiled/resume-from-claude",
    directory: resolve(repoRoot, "build/npm/claude"),
    expected: [
      "package.json",
      ".claude-plugin/plugin.json",
      "commands/resume-from.md",
      "dist/bin.js",
    ],
  },
  {
    name: "@alexeiled/resume-from-codex",
    directory: resolve(repoRoot, "build/npm/codex"),
    expected: ["package.json", ".codex-plugin/plugin.json", "prompts/resume-from.md"],
  },
];

function packedFiles(directory) {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const result = JSON.parse(output);
  const packed = Array.isArray(result)
    ? result.length === 1
      ? result[0]
      : undefined
    : Object.values(result).find((value) => value && typeof value === "object" && "files" in value);
  if (packed === undefined || !Array.isArray(packed.files)) {
    throw new Error(`unexpected npm pack output in ${directory}`);
  }
  return new Set(packed.files.map((file) => file.path));
}

function requireFile(files, packageName, path) {
  if (!files.has(path)) throw new Error(`${packageName} tarball is missing ${path}`);
}

for (const spec of packages) {
  const manifest = JSON.parse(readFileSync(resolve(spec.directory, "package.json"), "utf8"));
  if (manifest.name !== spec.name) throw new Error(`expected ${spec.name}, got ${manifest.name}`);
  if (manifest.version !== version) throw new Error(`${spec.name} version does not match ${version}`);

  const files = packedFiles(spec.directory);
  for (const path of spec.expected) requireFile(files, spec.name, path);
  console.log(`${spec.name}@${version}: ${files.size} files`);
}

const claudeMarketplace = JSON.parse(
  readFileSync(resolve(repoRoot, ".claude-plugin/marketplace.json"), "utf8"),
);
const codexMarketplace = JSON.parse(
  readFileSync(resolve(repoRoot, ".agents/plugins/marketplace.json"), "utf8"),
);
for (const marketplace of [claudeMarketplace, codexMarketplace]) {
  if (marketplace.version !== version || marketplace.plugins[0]?.source?.version !== version) {
    throw new Error("Marketplace version does not match the packages.");
  }
}

for (const [target, manifestPath] of [
  ["claude", "build/npm/claude/.claude-plugin/plugin.json"],
  ["codex", "build/npm/codex/.codex-plugin/plugin.json"],
]) {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, manifestPath), "utf8"));
  if (manifest.version !== version) throw new Error(`${target} plugin manifest has a stale version.`);
}

const claudeCommand = readFileSync(
  resolve(repoRoot, "build/npm/claude/commands/resume-from.md"),
  "utf8",
);
if (!claudeCommand.includes("${CLAUDE_PLUGIN_ROOT}/dist/bin.js")) {
  throw new Error("Claude command does not invoke its bundled CLI.");
}

const codexPrompt = readFileSync(
  resolve(repoRoot, "build/npm/codex/prompts/resume-from.md"),
  "utf8",
);
if (codexPrompt.includes("__RESUME_FROM_VERSION__") || !codexPrompt.includes(`resume-from@${version}`)) {
  throw new Error("Codex prompt does not pin the matching core CLI version.");
}
