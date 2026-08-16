# Troubleshooting

## The command does not appear

Make sure that the package is installed in the target agent. Then restart that
agent.

For Pi, list installed packages:

```sh
pi list
```

For Claude Code or Codex, open the plugin manager and make sure that
`resume-from` is enabled.

## No sessions are listed

`resume-from` lists sessions for the current Git repository. Run the command
from the repository that owns the source session.

If the source uses another profile, name its home with `--home`:

```text
/resume-from --home ~/.claude-team
```

For a profile you import from often, add that home to `extraHomes` instead, so
every listing includes it. See
[Configuration](configuration.md#add-another-profile).

The tool reports each home that it cannot read. Correct the path or its file
permissions.

## The preview is blocked

The required content is larger than the import budget. No target file was
written.

Increase `budgetShare`, reduce `pinnedRecentTurns`, or correct the target
context-window size. See
[Configuration](configuration.md#change-the-import-budget).

## `nothing to import`

The source session has no turns that can cross over. A session that holds only
slash commands — for example a session created by `/clear` — reads as empty.
Choose a session that holds conversation.

## `--target-agent is missing`

The direct binary needs the target agent. Installed host commands supply this
value.

Use this form for direct CLI work:

```sh
resume-from --target-agent codex --
```

Everything after `--` is the selection: a row number, session ID, or file path.

Use `resume-from --help` to show the complete syntax.

## Codex cannot reach npm

The Codex prompt uses a pinned package through `npx`. Make sure that the process
can reach `https://registry.npmjs.org`.

If the network is restricted, install the core command before you start Codex:

```sh
npm install --global resume-from
```

The current Codex prompt still uses its pinned `npx` command. The npm cache can
satisfy that command after one successful download.

## The import is complete, but the agent did not switch

Claude Code and Codex create a new native session but cannot switch the current
process. Run the landing command that `resume-from` prints.

```sh
claude --resume <session-id>
codex resume <thread-id>
```

Pi switches to the new session in the current process.

## The configuration file fails to load

The file must contain valid JSON. Remove comments and trailing commas.

Make sure that these limits are correct:

- `budgetShare` is greater than `0` and at most `1`.
- `pinnedRecentTurns` is a whole number of `0` or more.
- `windowTokens` is a whole number greater than `0`.
- Each agent is `pi`, `codex`, or `claude-code`.
