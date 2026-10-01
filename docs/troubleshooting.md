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

## A new release is not available on npm

A successful GitHub release does not mean that npm has made the packages available.
npm scans new versions before publication; scanning can delay availability or require
manual review. A pinned installation can return `404` during that time.

Check the core package version before retrying the install:

```sh
npm view resume-from@0.4.0 version
```

Claude Code and Codex also need their matching plugin packages:
`@alexeiled/resume-from-claude@0.4.0` and `@alexeiled/resume-from-codex@0.4.0`.
If a version remains unavailable, maintainers should check npm's publication
notifications before rerunning the release workflow.

## No sessions are listed

Start the destination agent in the directory whose files you intend to edit.
`resume-from` lists sessions for that Git repository, including linked worktrees in
nested, sibling, or arbitrary external locations and checkout subdirectories.
Independent clones, submodules, and nested independent repositories do not match.

In Claude Code or Codex, if the source uses another profile, name its home with `--home`:

```text
/resume-from claude --home ~/.claude-team
```

For a profile you import from often, add that home to `extraHomes` instead, so
every listing includes it. See
[Configuration](configuration.md#add-another-profile).

`--home` changes only the source profile, not the destination checkout. In Pi,
use `extraHomes` and the picker rather than CLI source filters.

The tool reports unreadable homes and sessions skipped for missing, unresolved,
conflicting, or operationally failed directory evidence. Read the diagnostic in the
listing or selection error; an explicit session ID or path does not bypass it.
Correct unreadable paths or permissions rather than retrying with guessed selectors.
A completed nonzero Git lookup means unresolved identity, not proof of a non-Git directory.

### The source worktree was removed or moved

Discovery can use another surviving directory recorded by the active conversation.
If all recorded paths are missing, even a removed worktree nested in the main
checkout cannot be identified by its parent. A moved worktree needs a recorded path
that resolves at its new location. There is no automatic path remapping or registry
recovery. Imports do not recreate removed worktrees or transfer uncommitted work.

### The preview names another destination or rejects confirmation

Check `Destination:` before confirming. If it is not where you intend to edit,
restart the destination agent in the right directory and obtain a fresh preview.
Different recorded directories can mean worktrees or merely subdirectories. Imports
do not switch branches. A token from a different worktree is invalid even when HEAD
and branch match. Source or destination changes can also require a new preview.
A bare repository is not a destination; use one of its linked working trees.

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
process. Run the landing command that `resume-from` prints from the preview's
destination directory, using the same target profile.

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
