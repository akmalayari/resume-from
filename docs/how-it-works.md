# How session transfer works

`resume-from` treats a handoff as a format conversion with an explicit safety boundary.

## Transfer pipeline

1. **Discover** — search supported agent homes for sessions that belong to the current Git repository.
2. **Read** — let the source adapter parse its native session format.
3. **Normalize** — convert supported content into one canonical conversation model.
4. **Filter** — remove data that must not cross and turn tool activity into non-replayable text.
5. **Budget** — keep pinned content and drop the oldest unpinned turns until the plan fits the target budget.
6. **Preview** — show source, target, kept and dropped content, token estimate, changed files, and warnings.
7. **Confirm** — write nothing unless the user explicitly approves an unblocked preview.
8. **Land** — serialize, validate, commit, read back, and either open the target session or print its native resume command.

The preview and commit use the same deterministic transfer plan. The transfer itself does not call a model.

## Canonical conversation model

Source adapters produce a small shared vocabulary:

- Source agent, profile, session ID, title, timestamps, and repository metadata.
- User and agent text turns.
- Compaction summaries.
- Tool records with a name, recorded argument text, one-line outcome, and effect classification.
- Changed-file paths.

Target adapters consume that vocabulary and write their own native format. No target adapter needs to understand another vendor's file layout.

## Content policy

| Content | Transfer behavior |
| --- | --- |
| User prompts and agent replies | Kept when selected by the budget. |
| Compaction summaries | Pinned. |
| Recent turns | Pinned according to `pinnedRecentTurns`. |
| Tool name and recorded arguments | Converted to plain text. |
| Tool outcome | Reduced to one line. |
| Tool-result body | Removed and marked as dropped. |
| Mutating tool activity | Kept as text and used to derive changed-file paths. |
| Incomplete trailing tool call | Removed. |
| Hidden reasoning and system prompts | Excluded. |
| Environment blocks, API keys, telemetry, vendor state | Excluded. |

Tool records are deliberately not serialized as executable calls. The destination sees what happened but is not instructed to replay it.

## Budget policy

The target budget is:

```text
floor(budgetShare × target context window)
```

The default `budgetShare` is `0.3`.

The importer pins the first user request, summaries, recent turns, and mutating tool records. It then removes the oldest unpinned turns until the estimated content fits.

If pinned content exceeds the budget, the preview is blocked. The error names the available remedies: increase `budgetShare`, lower `pinnedRecentTurns`, or choose a target with a larger window.

## Repository scope

Discovery compares each session's recorded repository path with the current repository. This prevents a row number, session ID, or file path from selecting unrelated work.

A session without repository metadata is reported as skipped. A source home that cannot be read is also reported; one bad home does not hide sessions from other homes.

## Commit and landing

After confirmation:

1. The target adapter serializes a new session.
2. The output is validated before commit.
3. The file is added to the target home without replacing an existing session.
4. The committed session is read back and checked as openable.
5. A provenance marker records the source and dropped content outside model context. Pi renders its
   persisted marker in the transcript, Claude Code uses its native metadata entry, and Codex prints
   the marker in CLI output because it has no verified safe durable entry.

The marker is never pinned as a footer or status line and is never represented as a tool result.

Pi can switch to the imported session in the current process. Claude Code and Codex create the session and return their native resume commands.

## Failure behavior

- Cancelling the picker or confirmation writes nothing.
- A blocked preview writes nothing.
- Invalid configuration stops before adapters are constructed.
- An unreadable source home is reported without suppressing other homes.
- A target validation, commit, or readback failure is reported as an error; it is not presented as a successful landing.
- The source session remains unchanged on success and failure paths.
