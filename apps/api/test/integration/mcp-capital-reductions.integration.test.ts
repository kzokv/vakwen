import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CapitalReductionPreviewDto } from "@vakwen/shared-types";
import { buildApp } from "../../src/app.js";
import { capitalReductionInput, confirmation, seedCapitalReductionHolding } from "../helpers/capitalReductionFixtures.js";

const credentials = (userId = "user-1", scopes = ["portfolio:mcp_read", "transaction:write"]) => ({ authorization: `Bearer vakwen-dev.${Buffer.from(JSON.stringify({ userId, scopes })).toString("base64url")}`, accept: "application/json, text/event-stream" });
describe("authenticated capital reduction MCP behavioral parity", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let sessionId: string;
  async function call(name: string, args: Record<string, unknown>, auth = credentials()) {
    const response = await app.inject({ method: "POST", url: "/mcp", headers: { ...auth, "mcp-session-id": sessionId }, payload: { jsonrpc: "2.0", id: `synthetic-${name}`, method: "tools/call", params: { name, arguments: args } } });
    expect(response.statusCode).toBe(200);
    const text = response.body.trim().startsWith("{") ? response.body : response.body.split("\n").find(row => row.startsWith("data: "))!.slice(6);
    return JSON.parse(text);
  }
  async function self() { const body = await call("list_portfolio_contexts", {}); const selected = body.result.structuredContent.portfolios.find((row: { isSelf: boolean }) => row.isSelf); return { label: selected.label, ...(selected.email ? { email: selected.email } : {}) }; }
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" }); await seedCapitalReductionHolding(app.persistence);
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const response = await app.inject({ method: "POST", url: "/mcp", headers: credentials(), payload: { jsonrpc: "2.0", id: "synthetic-init", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "synthetic-capital-reduction-qa", version: "1" } } } });
    expect(response.statusCode).toBe(200); sessionId = String(response.headers["mcp-session-id"]);
  });
  afterEach(async () => { await app.close(); });
  it("[R24]: actual tools/call preview and confirm → same financial contract and safe retry", async () => {
    const portfolio = await self(), preview = await call("preview_capital_reduction", { portfolio, input: capitalReductionInput() });
    expect(preview.result.isError).not.toBe(true); const dto = preview.result.structuredContent as CapitalReductionPreviewDto;
    expect(dto.calculation).toMatchObject({ wholeQuantity: 542, wholeCostAmount: 25418.69, fractionalCostAmount: 2.31 });
    const posted = await call("confirm_capital_reduction", { portfolio, confirmation: confirmation(dto) });
    expect(posted.result.isError).not.toBe(true); expect(posted.result.structuredContent.reconciliation.outstandingRepaymentAmount).toBe(4579);
    const retry = await call("confirm_capital_reduction", { portfolio, confirmation: confirmation(dto) });
    expect(retry.result.structuredContent.id).toBe(posted.result.structuredContent.id);
    const listed = await call("get_capital_reductions", { portfolio, accountId: "acc-1", ticker: "SYNTH" });
    expect(listed.result.structuredContent.actions).toHaveLength(1);
  });
  it.each(["tool", "input", "portfolio"])("[R24 strict registration]: actual tools/call unknown %s selector → rejection before financial facts", async where => {
    const portfolio = await self(), input = capitalReductionInput();
    const args = { portfolio: where === "portfolio" ? { ...portfolio, userId: "foreign-synthetic-user" } : portfolio, input: where === "input" ? { ...input, userId: "foreign-synthetic-user" } : input, ...(where === "tool" ? { userId: "foreign-synthetic-user" } : {}) };
    const result = await call("preview_capital_reduction", args);
    expect(result.result?.isError ?? Boolean(result.error)).toBe(true);
    expect((await app.persistence.loadStore("user-1")).accounting.facts.capitalReductions?.actions ?? []).toHaveLength(0);
  });
  it("[R24]: missing portfolio selector or transaction scope → mutation denied", async () => {
    const missing = await call("preview_capital_reduction", { input: capitalReductionInput() });
    expect(missing.result.isError).toBe(true);
    const denied = await call("preview_capital_reduction", { portfolio: await self(), input: capitalReductionInput() }, credentials("user-1", ["portfolio:mcp_read"]));
    expect(denied.result.isError).toBe(true); expect(JSON.stringify(denied)).toContain("transaction:write");
  });
  it("[R24]: delegated reader → no preview; transaction-capable delegate → scoped action and evidence", async () => {
    const actor = await app.persistence.resolveOrCreateUser("google", "synthetic-reader", { email: "synthetic-reader@example.test", name: "Synthetic Reader" });
    const grant = await app.persistence.createShareGrant({ ownerUserId: "user-1", granteeUserId: actor.userId, auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" } });
    await app.persistence.setShareCapabilities({ shareId: grant.id, capabilities: ["portfolio:mcp_read"], grantedByUserId: "user-1" });
    const contexts = await call("list_portfolio_contexts", {}, credentials(actor.userId));
    const owner = contexts.result.structuredContent.portfolios.find((row: { isSelf: boolean }) => !row.isSelf);
    const selector = { label: owner.label, ...(owner.email ? { email: owner.email } : {}) };
    const args = { portfolio: selector, input: capitalReductionInput() };
    const denied = await call("preview_capital_reduction", args, credentials(actor.userId));
    expect(denied.result.isError).toBe(true);
    await app.persistence.setShareCapabilities({ shareId: grant.id, capabilities: ["portfolio:mcp_read", "transaction:write"], grantedByUserId: "user-1" });
    const preview = await call("preview_capital_reduction", args, credentials(actor.userId));
    expect(preview.result.isError, JSON.stringify(preview)).not.toBe(true);
    await app.persistence.setShareCapabilities({ shareId: grant.id, capabilities: ["portfolio:mcp_read"], grantedByUserId: "user-1" });
    const revoked = await call("confirm_capital_reduction", { portfolio: selector, confirmation: confirmation(preview.result.structuredContent) }, credentials(actor.userId));
    expect(revoked.result.isError).toBe(true);
    expect((await app.persistence.loadStore("user-1")).accounting.facts.positionActions).toHaveLength(0);
    await app.persistence.setShareCapabilities({ shareId: grant.id, capabilities: ["portfolio:mcp_read", "transaction:write"], grantedByUserId: "user-1" });
    const result = await call("confirm_capital_reduction", { portfolio: selector, confirmation: confirmation(preview.result.structuredContent) }, credentials(actor.userId));
    expect(result.result.isError).not.toBe(true); expect(result.result.structuredContent.revisions[0].actorId).toBe(actor.userId);
    const stranger = await app.persistence.resolveOrCreateUser("google", "synthetic-stranger", { email: "synthetic-stranger@example.test", name: "Synthetic Stranger" });
    const forbidden = await call("get_capital_reductions", { portfolioContextUserId: "user-1" }, credentials(stranger.userId));
    expect(forbidden.result.isError).toBe(true); expect(JSON.stringify(forbidden)).not.toContain("synthetic-delivery");
  });
  it("[R02 R24]: source-only announcement MCP confirm → no financial posting", async () => {
    const portfolio = await self(), input = capitalReductionInput(); input.announcement.conversionDate = "2099-02-06";
    const preview = await call("preview_capital_reduction_announcement", { portfolio, input: { accountId: input.accountId, announcement: input.announcement, reason: "Synthetic source registration" } });
    expect(preview.result.isError).not.toBe(true);
    const result = await call("confirm_capital_reduction_announcement", { portfolio, confirmation: confirmation(preview.result.structuredContent) });
    expect(result.result.isError).not.toBe(true); expect(result.result.structuredContent.eventId).toBe("synthetic-event");
    expect((await app.persistence.loadStore("user-1")).accounting.facts.positionActions).toHaveLength(0);
  });
});
