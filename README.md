# resume-from

Continue a coding session in a different agent, or in a different profile of the same agent.

You type `/resume-from` in the agent you want to land in, pick a session another agent already wrote,
confirm a preview, and keep working. Nothing is explained twice.

```
❯ /resume-from
  1  codex   ~/.codex        14:32  make the auth token refresh work        23 turns
  2  claude  ~/.claude-team  11:05  split the billing module                 8 turns

❯ /resume-from 1
  From codex ~/.codex · 23 turns cross over, 12 dropped
  Budget: 34k tokens of a 200k window
  ⚠ Source ran at 3f2a1bc. The tree is now at 9d81e04 (14 commits ahead).
  12 older turns dropped · 9 tool result bodies dropped

❯ /resume-from 1 --confirm
```

## What crosses over, and what never does

**Crosses:** your messages, the agent's answers, summaries it made when it compacted, and every tool
call as a record — name, arguments, and one line of outcome.

**Never crosses:** the body of any tool result. Not once, not for any pair of agents, not even
between two profiles of the same agent. A file you read an hour ago may have changed since; carrying
its old contents into a fresh session is worse than carrying nothing, because the new agent would
trust them. Each dropped body is marked so the model knows to read the file again:

```
Read('src/auth.ts') → 400 lines (content dropped: imported session, may be stale)
```

Also never: hidden reasoning, system prompts, tokens, passwords, environment values, vendor state.
There is no field in the data model that can hold any of them.

## The rules it will not break

- **Your source session is never modified.** Every source file is byte-identical after an import.
- **Nothing is written until you confirm the preview.**
- **In the target home, it only adds.** No existing file is rewritten or deleted, ever.
- **A failed import leaves nothing behind** — a complete session or none at all.
- **An imported tool call cannot be replayed.** It is text.

## Supported agents

Pi, Claude Code, and Codex — all nine directions, including moving a session between two profiles of
the same agent.

| | Selection | Landing |
| --- | --- | --- |
| **Pi** | interactive picker | creates the session and moves you into it |
| **Claude Code** | numbered list | creates the session; you open it with `claude --resume <id>` |
| **Codex** | numbered list | creates the thread; you open it with `codex resume <id>` |

The difference is not a preference. Codex and Claude Code have a fixed command set, so the tool
cannot open its own picker inside them, and cannot move you between sessions. Pi can do both.

## Install

```sh
pnpm install
pnpm build
```

That produces the command binary (`dist/bin.js`), the library entry point, and the Pi extension
entry. The binary is usable now:

```sh
node dist/bin.js --target-agent codex          # list
node dist/bin.js --target-agent codex 1        # preview row 1
node dist/bin.js --target-agent codex 1 --confirm
```

`--target-agent` is required and never guessed: the caller states which agent it is running inside,
because guessing would import into the wrong one.

### Not yet written: the per-agent shims

What makes it `/resume-from` rather than a command you type in full is a small shim per agent, and
**none of the three exists yet**:

| Agent | Shim needed |
| --- | --- |
| Claude Code | a slash-command file that calls the binary with `--target-agent claude-code` |
| Codex | a prompt file that does the same with `--target-agent codex` |
| Pi | an extension manifest that loads `dist/host/pi-extension/index.js` in-process — required, because moving you into the new session needs a live command context |

They are deliberately absent rather than guessed. Each depends on a shim format this project has not
verified against the installed agent, and the whole adapter layer is built on the rule that facts
about an agent are confirmed, never assumed. Writing three plausible-looking files that silently do
not load would be worse than none.

## Configure

Optional. Everything has a default.

```jsonc
// ~/.config/resume-from/config.json
{
  "extraHomes": [{ "agent": "claude-code", "home": "~/.claude-team" }],
  "budgetShare": 0.30,        // share of the target's context window one import may use
  "pinnedRecentTurns": 5      // recent turns kept word for word, whatever the budget says
}
```

`extraHomes` is how a second profile becomes visible: add `~/.claude-team` and sessions from both
Claude Code profiles appear in one list.

Whatever the budget drops, it never drops your first request, the recent turns, the summaries, or the
list of files the session changed. If those alone exceed the budget, the import stops and says so
rather than quietly losing them.

## Development

```sh
pnpm test          # 1310 tests
pnpm typecheck
pnpm lint
```

Live tests exercise the real installed agents and are off by default:

```sh
RESUME_FROM_LIVE=1 pnpm test
```

Claude Code's live tests additionally need an authenticated throwaway home, because a fresh
`CLAUDE_CONFIG_DIR` is not logged in. Create one once — the tests never do this for you, and never
read your credentials:

```sh
CLAUDE_CONFIG_DIR="$HOME/.resume-from-live-home" claude   # log in
RESUME_FROM_LIVE=1 pnpm vitest run src/adapters/claude-code
```

## How it is built

The source tree *is* the design. Every folder under `src/` that contains a `module.md` is a module,
and that document is the complete specification of it — responsibilities, public contract,
constraints, and test specification. `src/module.md` is the architecture overview: the module map,
the flows, the full coupling assessment, and the decisions behind the shape.

```
src/
├── session/      the canonical session model — the neutral vocabulary every rule runs on
├── adapters/     the port, plus one folder per agent
├── import/       discovery → transfer → preview → landing
├── host/         the agent list, the wiring, and the two entry points
└── platform/     git, tokens, configuration, and the one guarded write path
```

Three properties are enforced by structure rather than by discipline, which is why they hold for
agents nobody has written yet:

- The canonical tool-call record **has no field for a result body**, so no adapter can carry one.
- Adapters return bytes; only `platform/store/` creates a file, so add-only and all-or-nothing are
  enforced once.
- No rule branches on an agent's name. Behaviour follows a declared capability, which is what keeps
  adding an agent to one folder and one line.

Adding an agent: a new folder under `src/adapters/`, a new value in `AgentId`, one line in
`src/host/`. Nothing in `src/import/` changes.

## Status

All 19 modules implemented; 1310 tests passing. Verified live: a real Codex session imports into Pi
and the turns are native there. Two things are deliberately **not** claimed as tested — compaction
over imported turns (it needs a real turn first) and Claude Code's live resume path (it needs the
one-time login above).

Two constants are still open questions from the requirements: the 30% budget share and the 5 pinned
turns. Both live in `src/platform/config/` and are answerable by changing one number.
