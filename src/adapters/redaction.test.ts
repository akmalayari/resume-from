import { describe, expect, it } from "vitest";
import * as claudeCode from "./claude-code/redaction.js";
import * as codex from "./codex/redaction.js";
import * as pi from "./pi/redaction.js";

const IMPLEMENTATIONS = [
  ["pi", pi],
  ["codex", codex],
  ["claude-code", claudeCode],
] as const;

describe.each(IMPLEMENTATIONS)("%s credential redaction", (_name, redaction) => {
  it("redacts sensitive keys and every value in environment maps", () => {
    expect(
      redaction.redactSensitiveStructure({
        api_key: "sk-12345678901234567890",
        nested: { refreshToken: "refresh-value" },
        env: { NORMAL_NAME: "also-private", PORT: 3000 },
        path: "src/token-refresh.ts",
      }),
    ).toEqual({
      api_key: redaction.REDACTED_VALUE,
      nested: { refreshToken: redaction.REDACTED_VALUE },
      env: {
        NORMAL_NAME: redaction.REDACTED_VALUE,
        PORT: redaction.REDACTED_VALUE,
      },
      path: "src/token-refresh.ts",
    });
  });

  it("redacts command assignments, exact secret flags, headers, tokens, and private keys", () => {
    const source = [
      "OPENAI_API_KEY=sk-12345678901234567890 node app.js --token github_pat_123456789012345678901234",
      "Authorization: Bearer abc.def.ghi",
      "X-Api-Key: plain-secret",
      "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
    ].join("\n");
    const redacted = redaction.redactSensitiveText(source);

    for (const secret of [
      "sk-12345678901234567890",
      "github_pat_123456789012345678901234",
      "abc.def.ghi",
      "plain-secret",
      "private-material",
    ]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain(redaction.REDACTED_VALUE);
  });

  it("preserves normal token-related filenames and non-secret options", () => {
    const source = "rg refreshToken src/token-refresh.ts --token-file fixtures/token.json";
    expect(redaction.redactSensitiveText(source)).toBe(source);
  });

  it.each([
    ["HTTP userinfo", "curl https://alice:supersecret@example.com/api", "supersecret"],
    ["database URI", "psql postgresql://alice:database-secret@db/prod", "database-secret"],
    ["curl short user flag", "curl -u alice:curl-secret https://example.com", "curl-secret"],
    [
      "curl long user flag",
      "curl --user='alice:quoted secret' https://example.com",
      "quoted secret",
    ],
  ])("redacts %s credentials in unstructured text", (_case, source, secret) => {
    const redacted = redaction.redactSensitiveText(source);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain(redaction.REDACTED_VALUE);
  });

  it("keeps JSON valid while redacting nested values", () => {
    const redacted = redaction.redactSensitiveArgumentsText(
      JSON.stringify({
        command: "API_KEY=top-secret npm test",
        path: "src/token.test.ts",
      }),
    );
    expect(JSON.parse(redacted)).toEqual({
      command: `API_KEY=${redaction.REDACTED_VALUE} npm test`,
      path: "src/token.test.ts",
    });
  });

  it("redacts split argv and structured user credentials", () => {
    const redacted = redaction.redactSensitiveStructure({
      command: ["curl", "-u", "alice:array-secret", "https://example.com"],
      nested: { user: "alice:object-secret" },
    });
    const canonical = JSON.stringify(redacted);

    expect(canonical).not.toContain("array-secret");
    expect(canonical).not.toContain("object-secret");
    expect(canonical).toContain(redaction.REDACTED_VALUE);
  });
});
