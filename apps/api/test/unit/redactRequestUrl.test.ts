import { describe, expect, it } from "vitest";
import { redactRequestUrl } from "../../src/lib/redactRequestUrl.js";

describe("request URL redaction", () => {
  it.each(["authorize", "redirect", "token", "consent/request/approve"])("OAuth %s: sensitive query → path-only diagnostics", path => {
    expect(redactRequestUrl(`/oauth/${path}?payload=secret-code&state=private-state&code_verifier=private-verifier`))
      .toBe(`/oauth/${path}?[REDACTED]`);
  });
  it("credential query on MCP: rejected token transport → no credential in request log", () => {
    expect(redactRequestUrl("/mcp?access_token=secret")).toBe("/mcp?[REDACTED]");
    expect(redactRequestUrl("/mcp?%63ode=secret")).toBe("/mcp?[REDACTED]");
  });
  it("anonymous share: path credential → redacted while ordinary URLs stay useful", () => {
    expect(redactRequestUrl("/share/abcdefghijklmnopqrstuv?locale=zh-TW")).toBe("/share/[REDACTED]?locale=zh-TW");
    expect(redactRequestUrl("/health?check=ready")).toBe("/health?check=ready");
  });
});
