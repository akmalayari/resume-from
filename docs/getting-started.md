# Install and run the first transfer

Install `resume-from` in the agent that will receive the imported session. Then run it from the Git repository that owns the source session.

## 1. Choose the destination

### Pi

```sh
pi install npm:resume-from
```

Restart Pi after installation.

### Claude Code

```sh
claude plugin marketplace add alexei-led/resume-from
claude plugin install resume-from@alexei-led-resume-from
```

Restart Claude Code if `/resume-from` does not appear.

### Codex

```sh
codex plugin marketplace add alexei-led/resume-from
codex plugin add resume-from@alexei-led-resume-from
```

The Codex prompt uses a pinned package through `npx`. Its first use needs access to the npm registry.

## 2. Open the repository in the destination agent

Start the destination agent in the same Git repository as the source session. Choose the destination model, provider, and profile before importing.

Session discovery is repository-scoped. A known session ID or file path still has to belong to the current repository.

## 3. Preview and import

### Pi workflow

1. Run `/resume-from`.
2. Select a source session in Pi's native picker.
3. Read the preview.
4. Confirm the import.

Pi creates and opens the new session in the current process. It leaves the prompt empty.

### Claude Code and Codex workflow

1. Run `/resume-from` to list matching sessions.
2. Run `/resume-from <row>` to preview one session.
3. Run the token-bearing `/resume-from <row> --confirm <token>` command printed by the preview.
4. Run the native landing command printed by the tool.

Claude Code prints:

```sh
claude --resume <session-id>
```

Codex prints:

```sh
codex resume <thread-id>
```

## Select a known session

The command accepts one row number, session ID, or session file path.

```text
# Pi
/resume-from <session-id>
/resume-from /absolute/path/to/session.jsonl
```

Claude Code and Codex also support source filters:

```text
# Claude Code / Codex
/resume-from --agent pi
/resume-from --agent claude --home ~/.claude-team
```

Pi uses its native picker for discovery and accepts a session ID or path directly.

## Check the preview

Before confirmation, verify:

- Source agent, profile, session, repository, and commit warning.
- Kept and dropped turn counts.
- Tool-result bodies removed.
- Estimated tokens and target budget.
- Changed-file paths.

Nothing has been written at this point. A blocked preview cannot be confirmed.

## Confirm success

A successful transfer has these properties:

- The source session is unchanged.
- A new target-native session exists.
- The target can open and read the new session.
- The imported session shows its source and what was dropped.
- Tool activity is plain text, not replayable calls.

Use `/resume-from --help` for the exact selectors and filters available in the current host.
