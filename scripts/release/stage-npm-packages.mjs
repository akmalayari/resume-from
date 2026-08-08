import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outputRoot = resolve(repoRoot, "build/npm");
const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const version = rootPackage.version;
const repository = "https://github.com/alexei-led/resume-from";

const packages = [
  {
    target: "claude",
    name: "@alexeiled/resume-from-claude",
    description: "Claude Code plugin for resuming a session from another coding agent.",
    files: [".claude-plugin", "commands", "dist"],
    install:
      "claude plugin marketplace add alexei-led/resume-from\nclaude plugin install resume-from@alexei-led-resume-from",
  },
  {
    target: "codex",
    name: "@alexeiled/resume-from-codex",
    description: "Codex plugin prompt for resuming a session from another coding agent.",
    files: [".codex-plugin", "prompts"],
    install:
      "codex plugin marketplace add alexei-led/resume-from\ncodex plugin add resume-from@alexei-led-resume-from",
  },
];

function packageManifest(spec) {
  const manifest = {
    name: spec.name,
    version,
    description: spec.description,
    type: rootPackage.type,
    engines: rootPackage.engines,
    license: "MIT",
    repository: { type: "git", url: `git+${repository}.git` },
    homepage: `${repository}#readme`,
    bugs: { url: `${repository}/issues` },
    keywords: [`${spec.target}-plugin`, "session", "handoff", "coding-agent"],
    files: spec.files,
    publishConfig: { access: "public" },
  };

  if (spec.target === "claude") {
    manifest.dependencies = rootPackage.dependencies;
  }

  return manifest;
}

function packageReadme(spec) {
  return `# ${spec.name}\n\n${spec.description}\n\nGenerated from [resume-from](${repository}).\n\n## Install\n\n\`\`\`sh\n${spec.install}\n\`\`\`\n\n## License\n\nMIT\n`;
}

function stagePackage(spec) {
  const destination = resolve(outputRoot, spec.target);
  const shim = resolve(repoRoot, "shims", spec.target === "claude" ? "claude-code" : "codex");
  cpSync(shim, destination, { recursive: true });
  cpSync(resolve(repoRoot, "LICENSE"), resolve(destination, "LICENSE"));
  if (spec.target === "claude") {
    cpSync(resolve(repoRoot, "dist"), resolve(destination, "dist"), {
      recursive: true,
      filter: (source) => statSync(source).isDirectory() || source.endsWith(".js"),
    });
  } else {
    const promptPath = resolve(destination, "prompts/resume-from.md");
    const prompt = readFileSync(promptPath, "utf8").replaceAll("__RESUME_FROM_VERSION__", version);
    writeFileSync(promptPath, prompt);
  }
  writeFileSync(
    resolve(destination, "package.json"),
    `${JSON.stringify(packageManifest(spec), null, 2)}\n`,
  );
  writeFileSync(resolve(destination, "README.md"), packageReadme(spec));
}

function main() {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) {
    throw new Error(`package version must be valid semver: ${version}`);
  }
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  for (const spec of packages) stagePackage(spec);
}

main();
