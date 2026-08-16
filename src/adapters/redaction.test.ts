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

  it("redacts a credential pasted as plain message text (FR-28, security)", () => {
    // A user who types 'curl -H "Authorization: Bearer sk-abc123" ...' as a message turn must
    // not have that token forwarded to a different model vendor when the session is resumed.
    const bearer = "sk-1234567890abcdef1234";
    const source = `can you run: curl -H "Authorization: Bearer ${bearer}" https://api.example.com`;
    const redacted = redaction.redactSensitiveText(source);

    expect(redacted).not.toContain(bearer);
    expect(redacted).toContain(redaction.REDACTED_VALUE);
  });

  // JSON_LIKE_PATTERN must not fire on bare prose words that follow a sensitive key name.
  // "token: word" in natural language is not a credential; only "token: word" in JSON/YAML
  // structure (where the value is bounded by ,;} or line-end) should be redacted (C-RED-1).
  it.each([
    ["no colon after key word", "please refactor the auth token refresh logic in src/auth.ts"],
    ["colon but value followed by space", "The current token: expired (error 401)"],
    ["colon but value mid-sentence", "The auth token: refresh the cache"],
  ])("leaves normal prose untouched: %s", (_label, prose) => {
    expect(redaction.redactSensitiveText(prose)).toBe(prose);
  });

  // The delimiter rule alone would also skip a real secret sitting mid-line; a digit in the
  // value keeps recall: opaque tokens carry digits, English words do not (C-RED-1).
  it.each([
    ["shell comment after the value", "password: hunter2 # prod box"],
    ["more flags after the value", "token: abc123 verbose true"],
  ])("still redacts a digit-bearing secret mid-line: %s", (_label, text) => {
    const redacted = redaction.redactSensitiveText(text);
    expect(redacted).toContain(redaction.REDACTED_VALUE);
    expect(redacted).not.toMatch(/hunter2|abc123/);
  });
});
