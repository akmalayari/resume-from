# Documentation

Choose the shortest guide for the task in front of you.

## Start and use `resume-from`

- [Install and run the first transfer](getting-started.md)
- [Common workflows and limitations](workflows.md)
- [How session transfer works](how-it-works.md)

## Install in a specific target agent

- [Pi](agents/pi.md)
- [Claude Code](agents/claude-code.md)
- [Codex](agents/codex.md)

The target-agent guide owns installation and landing instructions. The shared getting-started guide owns the cross-agent workflow.

## Configure and troubleshoot

- [Configuration](configuration.md) — extra agent homes, context budget, pinned turns, and context-window overrides.
- [Troubleshooting](troubleshooting.md) — missing commands, missing sessions, blocked previews, and landing problems.

## Maintain the project

- [Requirements](requirements.md) — normative product behavior and acceptance criteria.
- [Technical stack](tech-stack.md) — implementation choices and development constraints.
- [Implementation plan](plans/2026-08-04-implement-resume-from.md) — original delivery sequence.
- [Visual assets](visual-assets.md) — source artwork, palette, typography, rendering, and accessibility text.
- [`shims/README.md`](../shims/README.md) — host integration and package staging boundaries.

The files under `src/**/module.md` define internal module contracts. They are contributor references, not user guides.
