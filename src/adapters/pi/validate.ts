/**
 * The check that exists because of C-11 (FR-50).
 *
 * Pi reads six numbers of an assistant message's `usage` object without a guard —
 * `usage.input`, `usage.output`, `usage.cacheRead`, `usage.cacheWrite`,
 * `usage.totalTokens` and `usage.cost.total`. A missing `usage` stops Pi with
 * `TypeError: Cannot read properties of undefined (reading 'input')`, and it happens
 * after the file is already in the user's home. So the check runs before placement,
 * on the bytes, on every message, and it reports every defect it finds.
 *
 * Zero is a valid value. `Number.isFinite` is the test, never truthiness.
 */

import type { SerializedSession, ValidationDefect } from "./contract.js";
import { asHeader, isRecord } from "./format.js";

/** The fields Pi dereferences without a guard (C-11). */
const REQUIRED_USAGE_NUMBERS = [
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "totalTokens",
] as const;

const CRASH = "Pi reads this without a guard and stops with an uncaught TypeError (C-11)";

function usageDefects(usage: unknown, path: string): ValidationDefect[] {
  if (!isRecord(usage)) {
    return [
      {
        path,
        message: `assistant message has no usage object. ${CRASH}`,
      },
    ];
  }
  const defects: ValidationDefect[] = [];
  for (const field of REQUIRED_USAGE_NUMBERS) {
    if (!Number.isFinite(usage[field])) {
      defects.push({
        path: `${path}/${field}`,
        message: `usage.${field} is not a number. ${CRASH}`,
      });
    }
  }
  const cost = usage.cost;
  if (!isRecord(cost)) {
    defects.push({ path: `${path}/cost`, message: `usage.cost is not an object. ${CRASH}` });
  } else if (!Number.isFinite(cost.total)) {
    defects.push({
      path: `${path}/cost/total`,
      message: `usage.cost.total is not a number. ${CRASH}`,
    });
  }
  return defects;
}

export function validateSerialized(serialized: SerializedSession): ValidationDefect[] {
  const defects: ValidationDefect[] = [];

  if (serialized.files.length === 0) {
    return [{ path: "files", message: "a Pi session needs one session file, and none was made" }];
  }

  let storedItems = 0;

  for (const [fileIndex, file] of serialized.files.entries()) {
    const prefix = serialized.files.length > 1 ? `files/${fileIndex}/` : "";
    const lines = file.bytes
      .toString("utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      defects.push({ path: `${prefix}items`, message: "the session file is empty" });
      continue;
    }

    for (const [index, line] of lines.entries()) {
      const path = `${prefix}items/${index}`;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        defects.push({ path, message: "the line is not JSON, so Pi would skip or misread it" });
        continue;
      }

      if (index === 0) {
        const header = asHeader(value);
        if (!header) {
          defects.push({
            path,
            message: "the first line is not a Pi session header, so Pi cannot open the file",
          });
        } else if (header.id !== serialized.sessionId) {
          defects.push({
            path: `${path}/id`,
            message: `the header id ${header.id} is not the session id ${serialized.sessionId}`,
          });
        }
        continue;
      }

      storedItems += 1;

      if (!isRecord(value) || typeof value.type !== "string" || value.type.length === 0) {
        defects.push({ path, message: "the entry has no type, so Pi cannot place it" });
        continue;
      }
      if (typeof value.id !== "string" || value.id.length === 0) {
        defects.push({ path: `${path}/id`, message: "the entry has no id, so Pi's tree breaks" });
      }
      if (!(typeof value.parentId === "string" || value.parentId === null)) {
        defects.push({
          path: `${path}/parentId`,
          message: "the entry has no parentId, so Pi's tree breaks",
        });
      }
      if (typeof value.timestamp !== "string" || Number.isNaN(Date.parse(value.timestamp))) {
        defects.push({
          path: `${path}/timestamp`,
          message: "the entry has no ISO-8601 timestamp",
        });
      }

      if (value.type !== "message") continue;
      const message = isRecord(value.message) ? value.message : null;
      if (!message) {
        defects.push({ path: `${path}/message`, message: "the message entry carries no message" });
        continue;
      }
      if (message.role !== "assistant") continue;
      defects.push(...usageDefects(message.usage, `${path}/usage`));
    }
  }

  if (storedItems !== serialized.itemCount) {
    defects.push({
      path: "itemCount",
      message: `the session promises ${serialized.itemCount} items and the bytes hold ${storedItems}`,
    });
  }

  return defects;
}
