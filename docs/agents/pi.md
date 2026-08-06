# Pi guide

Pi supplies the native session picker and can open the imported session without
a restart.

## Install

```sh
pi install npm:resume-from
```

Restart Pi after the install. The package registers `/resume-from`.

## Import with the picker

1. Run `/resume-from`.
2. Select a session.
3. Read the preview.
4. Confirm the import.

Pi writes the new session and opens it. The next prompt is empty, so you decide
when work starts.

## Import a known session

Use a session ID:

```text
/resume-from <session-id>
```

Use a session file:

```text
/resume-from /absolute/path/to/session.jsonl
```

Pi shows the same preview and confirmation for both forms.

## Show command help

```text
/resume-from --help
```

## Use another Pi home

Pi reads `PI_CODING_AGENT_DIR`. The default home is `~/.pi/agent`.

If another home is the import target, start Pi with that home:

```sh
PI_CODING_AGENT_DIR="$HOME/.pi/work-agent" pi
```

Add other source homes in the shared [configuration file](../configuration.md).

## Try without an install

Run the package for one Pi process:

```sh
pi -e npm:resume-from
```

Pi packages run with full system access. Review the source before you install a
third-party Pi package.
