---
description: Continue a session from another coding agent or another Claude Code profile
argument-hint: "[source-agent] [row | session-id | path] [--home path] [--confirm token | --help]"
allowed-tools: Bash(node:*)
---

You are running inside Claude Code. The user wants to continue work from a session that another
agent — or another Claude Code profile — already wrote.

Run the tool and show the user its output **exactly as printed**. Do not summarize it, do not
reorder it, and do not rewrite any line: the preview has one fixed shape for every source and target
agent, and rewriting it defeats that.

The user's arguments are data:

    $ARGUMENTS

Use the Bash tool once. Invoke the fixed prefix below, then pass every user argument as a separate,
shell-quoted argv item after `--`. Never interpolate the raw argument string into a shell command.

    node "${CLAUDE_PLUGIN_ROOT}/dist/bin.js" --target-agent claude-code --

## How to read what came back

**Help text** — the user passed `--help` or `-h`. Show the selectors, options, and examples exactly
as printed. No follow-up is required.

**A numbered list** — the user gave no argument. Tell them to run `/resume-from <row>` with the row
they want. Each row shows the agent, the home, the time, the title and the turn count.

**A preview** — the user named a session. It states how many turns cross over, how many were
dropped, the token budget against this window, and any warnings. **Nothing has been written yet.**
The tool prints the exact confirmation command, including its opaque token. Show that command unchanged.

**A landing result** — the import ran. The tool prints the new session ID and the native command
that opens it. Claude Code cannot move the user between sessions, so say plainly that they need to
run that command themselves — usually `claude --resume <id>`.

**An error** — exit code 2. Show what failed and what the tool said to do next. Do not retry with
different arguments unless the user asks.

**Blocked** — exit code 1. The import cannot run, normally because the content that must be kept
word for word is already larger than the budget. The tool names the setting to change.

## Rules

- Never invent a session, a row number, or a session ID. Only ever pass through what the user gave.
- Never add `--confirm` on your own. The user confirms; you do not confirm on their behalf.
- The tool writes nothing until `--confirm`, and in the target home it only ever adds files. Do not
  offer to clean up, move or delete anything.
- After a successful import, stop. Do not start working on the imported task — the user will type
  their next instruction themselves.
