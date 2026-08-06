import { homedir } from "node:os";
import { join } from "node:path";
import { activatePiExtension } from "resume-from";
import { formatRow } from "resume-from/pi-extension";

const COMMAND_NAME = "resume-from";
const DESCRIPTION = "Continue another session. Use /resume-from --help for accepted arguments.";

function agentHome() {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function commandArgs(raw) {
  const trimmed = raw.trim();
  return trimmed === "" ? [] : trimmed.split(/\s+/);
}

function uiFor(context) {
  return {
    show(lines) {
      context.ui.notify(lines.join("\n"), "info");
    },
    async confirm(question) {
      return (await context.ui.confirm("Resume session", question)) ? "selected" : "cancelled";
    },
  };
}

function pickerFor(context) {
  return {
    async pick(listing) {
      if (!context.hasUI) return { choice: "cancelled", selected: null };

      const options = listing.rows.map((row, index) => `${index + 1}. ${formatRow(row)}`);
      const selected = await context.ui.select("Select a session to import", options);
      const row = listing.rows[selected === undefined ? -1 : options.indexOf(selected)];
      return row === undefined
        ? { choice: "cancelled", selected: null }
        : { choice: "selected", selected: row };
    },
  };
}

export default function resumeFrom(pi) {
  pi.registerCommand(COMMAND_NAME, {
    description: DESCRIPTION,
    async handler(rawArgs, context) {
      let command;
      await activatePiExtension({
        agent: "pi",
        registrar: { registerCommand: (definition) => (command = definition) },
        ui: uiFor(context),
        picker: pickerFor(context),
        home: agentHome(),
        cwd: context.cwd,
      });

      if (command === undefined) {
        throw new Error("resume-from: extension activation did not register /resume-from.");
      }

      await command.run(
        {
          cwd: context.cwd,
          home: agentHome(),
          switchSession: (path, options) => context.switchSession(path, options),
        },
        commandArgs(rawArgs),
      );
    },
  });
}
