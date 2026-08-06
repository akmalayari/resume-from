# Install and first import

This guide shows the common flow. Read the agent guide for the command that runs
in your target agent.

## Choose a target

Install `resume-from` in the target agent:

- Pi uses `pi install npm:resume-from`.
- Claude Code uses the `alexei-led/resume-from` marketplace.
- Codex uses the `alexei-led/resume-from` marketplace.

All three agents expose `/resume-from`. Claude Code and Codex also need the
plugin install command in the sections below.

## Install

Install the package in the agent that will receive the session.

### Pi

```sh
pi install npm:resume-from
```

Restart Pi after the install. Then run `/resume-from`.

### Claude Code

```sh
claude plugin marketplace add alexei-led/resume-from
claude plugin install resume-from@alexei-led-resume-from
```

Run `/resume-from` in Claude Code.

### Codex

```sh
codex plugin marketplace add alexei-led/resume-from
codex plugin add resume-from@alexei-led-resume-from
```

Run `/resume-from` in Codex. The Codex plugin uses the published `resume-from`
package. The first use needs access to the npm registry.

## Import a session

1. Run `/resume-from` with no selector.
2. Read the numbered session list.
3. Run `/resume-from <row>` with the row number.
4. Read the preview.
5. Run `/resume-from <row> --confirm`.

The exact command differs in Codex and Claude Code. Read the output from the
tool and follow its native landing command.

## Use a session ID or path

If you know the source session, use one selector.

```sh
resume-from --target-agent codex <session-id>
resume-from --target-agent codex /absolute/path/to/session.jsonl
```

The installed agent shims add the target agent. In a host command, use the host
command instead of the binary form.

## Show help

Use `--help` or `-h` to list selectors, filters, and examples.

```sh
resume-from --target-agent codex --help
```

## What happens after confirmation

Pi opens the new session in the same process. Claude Code and Codex create the
new session and print the native command that opens it. Run that command
yourself.

The source session remains unchanged. The target home receives new files only.
