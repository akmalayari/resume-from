# Codex guide

The Codex plugin adds a `/resume-from` prompt. The prompt runs the matching
published command package.

## Install

```sh
codex plugin marketplace add alexei-led/resume-from
codex plugin add resume-from@alexei-led-resume-from
```

Use Codex CLI or the Codex desktop application. The Codex IDE extension does not
install plugins.

## Network requirement

The prompt runs a pinned `resume-from` version through `npx --yes`. The first
use needs access to the npm registry. Later use can use the local npm cache.

## Import a session

1. Run `/resume-from`.
2. Read the numbered list.
3. Run `/resume-from <row>`.
4. Read the preview.
5. Run the token-bearing `/resume-from <row> --confirm <token>` command printed by the preview.

Codex cannot move the current process into the new thread. The command prints
the new thread ID and the native resume command.

```sh
codex resume <thread-id>
```

Run that command in a terminal.

## Filter the source list

List sessions from one agent:

```text
/resume-from claude
/resume-from pi
/resume-from codex
```

List sessions from one home:

```text
/resume-from --agent codex --home ~/.codex-work
```

Use `--help` to show all selectors and options.

```text
/resume-from --help
```

## Use another Codex home

Codex reads `CODEX_HOME`. The default home is `~/.codex`.

Start Codex with another target home:

```sh
CODEX_HOME="$HOME/.codex-work" codex
```

Add other source homes in the shared [configuration file](../configuration.md).
