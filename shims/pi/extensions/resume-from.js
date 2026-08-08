import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { activatePiExtension } from "resume-from";
import { formatRow, safeLines, safeText } from "resume-from/pi-extension";

const COMMAND_NAME = "resume-from";
const DESCRIPTION =
  "Continue another session. Use /resume-from --help for accepted arguments.";
const PROVENANCE_CUSTOM_TYPE = "resume-from-provenance";

function provenanceLines(entries) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== PROVENANCE_CUSTOM_TYPE)
      continue;
    const lines = entry.data?.lines;
    return Array.isArray(lines) &&
      lines.every((line) => typeof line === "string")
      ? lines
      : null;
  }
  return null;
}

function agentHome() {
  const configured = process.env.PI_CODING_AGENT_DIR;
  if (configured === undefined) return join(homedir(), ".pi", "agent");
  return isAbsolute(configured) ? configured : resolve(configured);
}

function commandArgs(raw) {
  const trimmed = raw.trim();
  return trimmed === "" ? [] : [trimmed];
}

function uiFor(context) {
  return {
    show(lines) {
      context.ui.notify(safeLines(lines).join("\n"), "info");
    },
    async confirm(question) {
      return (await context.ui.confirm("Resume session", safeText(question)))
        ? "selected"
        : "cancelled";
    },
  };
}

function pickerFor(context) {
  return {
    async pick(listing) {
      if (!context.hasUI) return { choice: "cancelled", selected: null };

      const options = listing.rows.map((row, index) =>
        safeText(`${index + 1}. ${formatRow(row)}`),
      );
      const selected = await context.ui.select(
        "Select a session to import",
        options,
      );
      const row =
        listing.rows[selected === undefined ? -1 : options.indexOf(selected)];
      return row === undefined
        ? { choice: "cancelled", selected: null }
        : { choice: "selected", selected: row };
    },
  };
}

export default function resumeFrom(pi) {
  pi.on("session_start", (_event, context) => {
    const lines = provenanceLines(context.sessionManager.getEntries());
    context.ui.setWidget(
      PROVENANCE_CUSTOM_TYPE,
      lines === null ? undefined : safeLines(lines),
    );
  });

  pi.registerCommand(COMMAND_NAME, {
    description: DESCRIPTION,
    async handler(rawArgs, context) {
      const home = agentHome();
      let command;
      await activatePiExtension({
        agent: "pi",
        registrar: { registerCommand: (definition) => (command = definition) },
        ui: uiFor(context),
        picker: pickerFor(context),
        home,
        cwd: context.cwd,
      });

      if (command === undefined) {
        throw new Error(
          "resume-from: extension activation did not register /resume-from.",
        );
      }

      await command.run(
        {
          cwd: context.cwd,
          home,
          switchSession: (path, options) =>
            context.switchSession(path, options),
        },
        commandArgs(rawArgs),
      );
    },
  });
}
