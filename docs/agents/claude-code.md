# Claude Code guide

The Claude Code plugin adds `/resume-from` and includes the matching command
binary.

## Install

```sh
claude plugin marketplace add alexei-led/resume-from
claude plugin install resume-from@alexei-led-resume-from
```

If the command does not appear, restart Claude Code.

## Import a session

1. Run `/resume-from`.
2. Read the numbered list.
3. Run `/resume-from <row>`.
4. Read the preview.
5. Run the token-bearing `/resume-from <row> --confirm <token>` command printed by the preview.

Claude Code cannot move the current process into the new session. The command
prints the new session ID and the native resume command.

```sh
claude --resume <session-id>
```

Run that command in a terminal.

## Filter the source list

List sessions from one agent:

```text
/resume-from codex
/resume-from pi
/resume-from claude
```

List sessions from one home:

```text
/resume-from --agent claude --home ~/.claude-team
```

Use `--help` to show all selectors and options.

```text
/resume-from --help
```

## Use another Claude Code profile

Claude Code reads `CLAUDE_CONFIG_DIR`. The default home is `~/.claude`. When `CLAUDE_CONFIG_DIR` is set, `resume-from` also uses it as the default home for Claude Code sessions.

Start Claude Code with another target profile:

```sh
CLAUDE_CONFIG_DIR="$HOME/.claude-team" claude
```

Add other source profiles in the shared
[configuration file](../configuration.md).

## Runtime details

The plugin runs its bundled `dist/bin.js`. A separate global install of
`resume-from` is not necessary.
