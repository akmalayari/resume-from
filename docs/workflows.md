# Common workflows and limitations

`resume-from` creates a new native session in the destination agent. It transfers conversation context, not the repository, credentials, or a running process.

## Switch to another model or provider

1. Start the destination agent with the model and provider you want.
2. Open the same Git repository.
3. Run `/resume-from` and import the source session.

The destination controls the active model. `resume-from` does not select or copy model credentials.

This works between different agents and between two profiles of the same agent.

## Switch harnesses and toolsets

Use this when the repository and task remain the same but you want another terminal interface, permission model, extension set, or collection of tools.

Examples:

- Pi to Claude Code for a different tool harness.
- Claude Code to Codex for another model or workflow.
- Codex to Pi for Pi extensions and native session controls.

Tool calls from the source become plain text. The destination does not inherit executable tool state and can inspect the current repository before acting.

## Continue after a usage limit

If one provider, account, or tool reaches a rate or usage limit:

1. Leave the source session saved.
2. Start another supported agent or profile in the same repository.
3. Import the saved session.
4. Continue from the new native session.

`resume-from` does not bypass a provider limit. It makes the saved task context available to another destination that you can already use.

## Move between profiles

The destination profile is the profile used by the running target agent:

| Agent | Profile variable | Default home |
| --- | --- | --- |
| Pi | `PI_CODING_AGENT_DIR` | `~/.pi/agent` |
| Claude Code | `CLAUDE_CONFIG_DIR` | `~/.claude` |
| Codex | `CODEX_HOME` | `~/.codex` |

To search additional source profiles, add them to `extraHomes` in the shared [configuration](configuration.md).

Example:

```json
{
  "extraHomes": [
    { "agent": "claude-code", "home": "~/.claude-team" },
    { "agent": "pi", "home": "~/.pi/work-agent" }
  ]
}
```

## Start a fresh context without losing the task

The importer budgets history against the destination context window. By default it may use 30% of that window.

It pins:

- The first user request.
- The configured number of recent turns.
- Compaction summaries.
- Mutating tool records used to derive changed-file paths.

If the full history does not fit, it drops the oldest unpinned turns and reports them in the preview. If pinned content alone does not fit, it blocks before writing.

This is a controlled handoff, not guaranteed full-history preservation.

## Create an independent review copy

Importing never replaces the source session. You can create a destination-side copy for review or experimentation, then return to the original session later.

The two sessions do not synchronize after import. New messages and tool activity remain local to the session where they occur.

## Current limits

- Supported agents are Pi, Claude Code, and Codex.
- Discovery only lists sessions that record the current Git repository.
- Sessions without repository metadata are reported but cannot be selected.
- Selection by file path does not bypass repository scope.
- Repository files are not copied. The destination needs access to the working tree.
- Credentials, model selection, hidden reasoning, system prompts, environment data, telemetry, and vendor runtime state do not transfer.
- Tool-result bodies do not transfer.
- Pi can switch in process. Claude Code and Codex require the printed native resume command.
- The Codex plugin's first run needs npm access unless its pinned package is already cached.
