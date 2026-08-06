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
      "README.md",
      "LICENSE",
      "dist/bin.js",
      "dist/index.d.ts",
      "dist/host/pi-extension/index.js",
      "shims/pi/extensions/resume-from.js",
    ],
    maxUnpackedBytes: 500_000,
    forbidden: (path) => path.startsWith("assets/") || path.endsWith(".map"),
  },
  {
    name: "@alexeiled/resume-from-claude",
    directory: resolve(repoRoot, "build/npm/claude"),
    expected: [
      "package.json",
      "README.md",
      "LICENSE",
      ".claude-plugin/plugin.json",
      "commands/resume-from.md",
      "dist/bin.js",
    ],
    maxUnpackedBytes: 300_000,
    forbidden: (path) => path.endsWith(".d.ts") || path.endsWith(".map"),
  },
  {
    name: "@alexeiled/resume-from-codex",
    directory: resolve(repoRoot, "build/npm/codex"),
    expected: [
      "package.json",
      "README.md",
      "LICENSE",
      ".codex-plugin/plugin.json",
      "prompts/resume-from.md",
    ],
    maxUnpackedBytes: 20_000,
    forbidden: (path) => path.startsWith("dist/"),
  },
];

function packedPackage(directory) {
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
  return {
    files: new Set(packed.files.map((file) => file.path)),
    packedBytes: packed.size,
    unpackedBytes: packed.unpackedSize,
  };
}

function requireFile(files, packageName, path) {
  if (!files.has(path)) throw new Error(`${packageName} tarball is missing ${path}`);
}

for (const spec of packages) {
  const manifest = JSON.parse(readFileSync(resolve(spec.directory, "package.json"), "utf8"));
  if (manifest.name !== spec.name) throw new Error(`expected ${spec.name}, got ${manifest.name}`);
  if (manifest.version !== version) throw new Error(`${spec.name} version does not match ${version}`);

  const packed = packedPackage(spec.directory);
  for (const path of spec.expected) requireFile(packed.files, spec.name, path);
  const forbidden = [...packed.files].filter(spec.forbidden);
  if (forbidden.length > 0) {
    throw new Error(`${spec.name} tarball contains forbidden files: ${forbidden.join(", ")}`);
  }
  if (packed.unpackedBytes > spec.maxUnpackedBytes) {
    throw new Error(
      `${spec.name} tarball is ${packed.unpackedBytes} unpacked bytes; limit is ${spec.maxUnpackedBytes}`,
    );
  }
  console.log(
    `${spec.name}@${version}: ${packed.files.size} files, ${packed.packedBytes} packed bytes, ` +
      `${packed.unpackedBytes} unpacked bytes`,
  );
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
