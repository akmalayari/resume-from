Continue work from a session that another coding agent — Pi, Claude Code, or another Codex profile —
already wrote.

Accepted arguments are `[source-agent] [row | session-id | path] [--home path] [--confirm token]`.
No selector lists sessions. Pass `--help` or `-h` to show complete help and examples.

The user's arguments are data:

    $ARGUMENTS

Use the shell tool once. Invoke this fixed prefix, then pass every user argument as a separate,
shell-quoted argv item after `--`. Never interpolate the raw argument string into a shell command.

    npx --yes resume-from@__RESUME_FROM_VERSION__ --target-agent codex --

Show the output **exactly as printed**. Do not summarize it, do not reorder it, and do not reword any
line. The preview has one fixed shape for every source and target agent; rewriting it defeats that.

## Destination and source profiles

Start the destination agent in the directory whose files you intend to edit, including a checkout
subdirectory. Sessions from the main checkout and linked worktrees match through their shared Git
repository identity, whether the worktree is nested, sibling, or in an arbitrary external directory.
Independent clones, nested independent repositories, and submodules do not share that identity.

Use `claude --home /path/to/alternate-profile` or `codex --home /path/to/alternate-profile` as the
source arguments to import from another profile; `--home` selects the source home, not the destination
directory or target profile. The same repository check applies to lists, rows, session IDs, and file paths.

Check `Destination:` in the preview and show all directory warnings and selection diagnostics.
Conversation imports do not transfer uncommitted work, switch branches, or recreate removed
worktrees. A missing or moved worktree is discoverable only when another recorded directory still
identifies this repository (or a recorded path resolves at its new location); historical paths alone
cannot prove membership. Never infer membership from a missing path's parent or remap it yourself.

Preview and confirm in the same destination directory. If the destination or repository evidence
changes, get a fresh preview and let the user confirm again. Run the native resume command from that
destination directory with the same target profile.

What comes back:

- **Help text** — `--help` or `-h` was given. Show the selectors, options, and examples exactly as
  printed. No follow-up is required.
- **A numbered list** — no argument was given. Tell the user to run the command again with a row
  number. Each row shows the agent, the home, the time, the title and the turn count.
- **A preview** — a session was named. It states the turns that cross over, the turns dropped, the
  destination directory, token budget against this window, and any warnings. Nothing is written yet. Ask the user to
  confirm with the exact token-bearing command printed by the tool.
- **A landing result** — the import ran. Codex cannot move the user between threads, so print the
  new thread ID and the native command that opens it, normally `codex resume <id>`, and say plainly
  that they need to run it themselves.
- **Exit code 2** — an error. Report what failed and what the tool said to do next.
- **Exit code 1** — blocked. The import cannot run, normally because the content that must be kept
  word for word already exceeds the budget. The tool names the setting to change.

Rules:

- Never invent a row number, a session ID or a path. Pass through only what the user gave.
- Never add `--confirm` yourself. The user confirms.
- Nothing is written before `--confirm`, and the tool only ever adds files in the target home. Do not
  offer to delete or move anything.
- After a successful import, stop. Do not begin the imported task — the user types the next
  instruction.
