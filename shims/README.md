# Host shims

The core package owns session discovery, transfer, previews, and confirmation. These host files only
make that single implementation available as `/resume-from`.

| Host | Package | Entry point |
| --- | --- | --- |
| Pi | `resume-from` | `shims/pi/extensions/resume-from.js` registered through the `pi.extensions` manifest |
| Claude Code | `@alexeiled/resume-from-claude` | `commands/resume-from.md` invokes the bundled `dist/bin.js` |
| Codex | `@alexeiled/resume-from-codex` | `prompts/resume-from.md` invokes the matching published CLI with `npx` |

## Boundaries

- No shim contains transfer, preview, confirmation, or output-format rules.
- Claude Code and Codex state `--target-agent` explicitly. They do not infer the target agent.
- Only the user supplies `--confirm`.
- The Pi extension uses Pi's documented `registerCommand`, `ui.select`, `ui.confirm`, and
  `switchSession` APIs. It keeps the live command context only long enough to switch into the new
  session.

## Packaging

`scripts/release/stage-npm-packages.mjs` stages the Claude and Codex npm artifacts into
`build/npm/`. `npm run packages:check` dry-packs the core and both plugin artifacts, checks their
manifests, and verifies that Claude invokes its bundled CLI while Codex pins the matching core CLI
version.
