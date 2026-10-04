import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return { ...original, Env: { ...original.Env, AUTH_MODE: "dev_bypass", SESSION_SECRET: "disclosure-mcp-test-secret-at-least-32-characters" } };
});

import { listMcpToolDefinitions, setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";

let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;
const subject = { kind: "listing_id", listingId: "lst_unknown" };
const context = { knowledgeAt: "2026-10-04T12:00:00.000Z" };
const names = ["list_material_announcements", "get_disclosure_artifact"] as const;

interface RpcResponse {
  result?: { isError?: boolean; content?: Array<{ text: string }>; structuredContent?: { result: { code?: string; statusCode?: number; metadata?: { retryable?: boolean } } }; tools?: Array<{ name: string; inputSchema: Record<string, unknown> }> };
  error?: { message: string };
}

function parseResponse(body: string): RpcResponse {
  const data = body.trim().startsWith("{") ? body : body.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  if (!data) throw new Error("MCP response did not contain JSON");
  return JSON.parse(data) as RpcResponse;
}

async function session(scopes = ["research:read"]) {
  const token = `vakwen-dev.${Buffer.from(JSON.stringify({ userId: "user-1", scopes })).toString("base64url")}`;
  const headers = { host: "localhost:4000", authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" };
  const response = await app.inject({ method: "POST", url: "/mcp", headers, payload: {
    jsonrpc: "2.0", id: "initialize", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "DisclosureTest", version: "1" } },
  } });
  expect(response.statusCode).toBe(200);
  return { ...headers, "mcp-session-id": String(response.headers["mcp-session-id"]) };
}

async function call(headers: Awaited<ReturnType<typeof session>>, name: typeof names[number], args: Record<string, unknown>) {
  const response = await app.inject({ method: "POST", url: "/mcp", headers, payload: {
    jsonrpc: "2.0", id: "call", method: "tools/call", params: { name, arguments: args },
  } });
  return parseResponse(response.body);
}

describe("disclosure MCP registration", () => {
  beforeEach(async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, mcpExposureEnabled: true, skillExposureEnabled: true });
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp({ persistenceBackend: "memory" });
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { research: true }, bearerFallback: { allowedToolGroups: ["read", "research"] } });
  });
  afterEach(async () => {
    setResearchRolloutOverrideForTest(null);
    await app?.close();
  });

  it("disclosure discovery: enable research → expose concrete read-only schemas", async () => {
    const headers = await session();
    const response = await app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: "list", method: "tools/list", params: {} } });
    const listed = parseResponse(response.body).result?.tools;
    for (const name of names) {
      const definition = listMcpToolDefinitions().find((tool) => tool.name === name)!;
      expect(definition.scope).toBe("research:read");
      expect(definition.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      expect(definition.outputSchema.safeParse({ result: {} }).success).toBe(false);
      for (const code of ["research_range_invalid", "research_artifact_not_referenced", "research_store_unavailable", "record_too_large"]) {
        expect(definition.outputSchema.safeParse({ result: { code, message: "Safe disclosure error", statusCode: code === "research_store_unavailable" ? 503 : 422 } }).success).toBe(true);
      }
      const inputSchema = listed?.find((tool) => tool.name === name)?.inputSchema;
      expect(inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      const validate = new AjvJsonSchemaValidator().getValidator(inputSchema!);
      const initial = { subject, context, ...(name === "get_disclosure_artifact" ? { artifactId: "artifact_1" } : {}) };
      expect(validate(initial).valid).toBe(true);
      expect(validate({ subject, cursor: "opaque_cursor" }).valid).toBe(true);
      expect(validate({ subject }).valid).toBe(false);
      expect(validate({ ...initial, cursor: "opaque_cursor" }).valid).toBe(false);
      expect(validate({ subject, cursor: "opaque_cursor", limit: 1 }).valid).toBe(false);
      expect(listed?.find((tool) => tool.name === name)).toMatchObject({ execution: { taskSupport: "forbidden" } });
      expect(listed?.find((tool) => tool.name === name)).not.toHaveProperty("_meta.openai/outputTemplate");
      expect(listed?.find((tool) => tool.name === name)).not.toHaveProperty("_meta.ui.resourceUri");
    }
  });

  it("disclosure input: supply arbitrary URL or mutate continuation → reject without store reads", async () => {
    const headers = await session();
    const reads = [
      vi.spyOn(app.persistence, "listResearchIdentityRecords"),
      vi.spyOn(app.persistence, "listResearchIdentityLatestRevisions"),
      vi.spyOn(app.persistence, "listResearchAnnouncements"),
      vi.spyOn(app.persistence, "listResearchDisclosureScans"),
      vi.spyOn(app.persistence, "listResearchDisclosureArtifacts"),
      vi.spyOn(app.persistence, "listResearchDisclosureMaterialReferences"),
    ];
    for (const name of names) {
      const initial = { subject, context, ...(name === "get_disclosure_artifact" ? { artifactId: "artifact_1" } : {}) };
      const response = await call(headers, name, { ...initial, url: "https://untrusted.example/secret" });
      expect(response.error || response.result?.isError).toBeTruthy();
      for (const invalid of [{ subject, cursor: "cursor", limit: 1 }, { subject }, { ...initial, cursor: "cursor", limit: 1 }]) {
        const rejected = await call(headers, name, invalid);
        expect(rejected.error).toBeUndefined();
        expect(rejected.result?.isError).toBe(true);
        expect(rejected.result?.structuredContent?.result).toMatchObject({
          code: "mcp_tool_validation_error", statusCode: 422,
        });
        expect(rejected.result?.structuredContent?.result.metadata?.retryable).not.toBe(true);
        expect(JSON.stringify(rejected)).not.toContain("evaluation_failed");
      }
    }
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });

  it("disclosure authorization: portfolio-only grant → deny both tools", async () => {
    const headers = await session(["portfolio:mcp_read"]);
    for (const name of names) {
      const response = await call(headers, name, { subject, context, ...(name === "get_disclosure_artifact" ? { artifactId: "artifact_1" } : {}) });
      expect(response.result?.isError).toBe(true);
      expect(response.result?.structuredContent?.result.code).not.toBe("research_subject_not_found");
    }
  });

  it("disclosure rollout: disable research in an existing session → deny further reads", async () => {
    const headers = await session();
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, mcpExposureEnabled: false, skillExposureEnabled: false });
    const response = await call(headers, "list_material_announcements", { subject, context });
    expect(response.result?.isError).toBe(true);
    expect(listMcpToolDefinitions().some((tool) => names.includes(tool.name as typeof names[number]))).toBe(false);
  });

  it("disclosure persistence: store failure → return a sanitized typed error", async () => {
    const headers = await session();
    const sensitiveMessage = "postgres://user:password@internal-db/private";
    const audit = vi.spyOn(app.persistence, "appendAiConnectorAccessLog");
    vi.spyOn(app.persistence, "listResearchIdentityLatestRevisions").mockRejectedValue(new Error(sensitiveMessage));
    vi.spyOn(app.persistence, "listResearchIdentityRecords").mockRejectedValue(new Error(sensitiveMessage));
    for (const name of names) {
      const response = await call(headers, name, { subject, context, ...(name === "get_disclosure_artifact" ? { artifactId: "artifact_1" } : {}) });
      expect(response.result?.isError).toBe(true);
      expect(response.result?.structuredContent?.result.code).toBe("research_store_unavailable");
      expect(JSON.stringify(response)).not.toContain(sensitiveMessage);
    }
    expect(JSON.stringify(audit.mock.calls)).not.toContain(sensitiveMessage);
  });
  it("shared persistence outage: reads and audit fail → preserve sanitized disclosure error", async () => {
    const headers = await session();
    const sensitiveMessage = "postgres://user:password@internal-db/private";
    vi.spyOn(app.persistence, "listResearchIdentityLatestRevisions").mockRejectedValue(new Error(sensitiveMessage));
    vi.spyOn(app.persistence, "listResearchIdentityRecords").mockRejectedValue(new Error(sensitiveMessage));
    vi.spyOn(app.persistence, "appendAiConnectorAccessLog").mockRejectedValue(new Error(sensitiveMessage));
    for (const name of names) {
      const response = await call(headers, name, { subject, context, ...(name === "get_disclosure_artifact" ? { artifactId: "artifact_1" } : {}) });
      expect(response.result?.isError).toBe(true);
      expect(response.result?.structuredContent?.result.code).toBe("research_store_unavailable");
      expect(JSON.stringify(response)).not.toContain(sensitiveMessage);
    }
  });

});
