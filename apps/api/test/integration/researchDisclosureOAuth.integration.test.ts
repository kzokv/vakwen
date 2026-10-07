import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Persistence } from "../../src/persistence/types.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import type { ResearchAnnouncementRecord, ResearchDisclosureArtifact, ResearchDisclosureScan } from "../../src/services/research/disclosureContracts.js";
import type { MaterialAnnouncementsOutput, DisclosureArtifactOutput } from "../../src/services/research/contracts.js";
import { disclosureArtifactOutputSchema, materialAnnouncementsOutputSchema, researchIdentityOutputSchema, researchManifestOutputSchema, researchQuerySchema } from "../../src/services/research/contracts.js";
import { buildFocusedDisclosureResearchReport, renderFocusedDisclosureResearchReportMarkdown } from "../../src/services/research/disclosureReport.js";
import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";
vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return { ...original, Env: { ...original.Env, AUTH_MODE: "oauth" as const, NODE_ENV: "test", PERSISTENCE_BACKEND: "memory" as const } };
});
import { signSessionCookie } from "../../src/auth/googleOAuth.js";
let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;
async function disclosureFixture(persistence: Persistence, venue: "TWSE" | "TPEX" = "TWSE") {
  const identity = canonicalizeOfficialIdentityRow({ venue, snapshotDate: "2026-08-31", retrievedAt: "2026-08-31T02:00:00.000Z", artifact: { contentHash: "fixture", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" }, row: { kind: "company", ticker: "2330", legalName: "公司", displayName: "公司", unifiedBusinessNumber: "22099131", industryCode: "24", listedAt: "1994-09-05" } });
  await persistence.appendResearchIdentityRecords([identity]);
  const context = { knowledgeAt: "2026-09-01T02:00:00.000Z" };
  const subject = { kind: "listing_id" as const, listingId: identity.listing.id };
  const provenance: ResearchAnnouncementRecord["provenance"] = { id: "pr1", publisher: "MOPS", accessProvider: venue === "TWSE" ? "TWSE_OPENAPI" : "TPEX_OPENAPI", authorityRole: "authoritative", sourceUrl: "https://mops.twse.com.tw/a", contentHash: "a".repeat(64), retrievedAt: "2026-09-01T01:59:00.000Z", processedAt: "2026-09-01T01:59:00.000Z", acquisitionRunId: "run1", parserVersion: "disclosures/1.0.0", usagePolicyVersion: "taiwan-open-data/1.0.0" };
  const announcement: ResearchAnnouncementRecord = { id: "ann1", issuerId: identity.issuer.id, listingId: identity.listing.id, ticker: "2330", venue, publishedAt: "2026-09-01T01:00:00.000Z", publicationPrecision: "second", subject: "重大訊息", ruleClause: "51", eventDate: "2026-09-01", explanation: "😀".repeat(20_001), sourceUrl: provenance.sourceUrl, attachments: [{ id: "attachment1", artifactId: "artifact1", title: "說明", mediaType: "text/plain", sourceUrl: provenance.sourceUrl }], relations: [], quality: "available", provenance };
  const artifact: ResearchDisclosureArtifact = { id: "artifact1", issuerId: identity.issuer.id, publishedAt: announcement.publishedAt, contentHash: provenance.contentHash, extractionVersion: "extract/1", sourceUrl: provenance.sourceUrl, mediaType: "text/plain", reference: { kind: "announcement_attachment", id: announcement.id }, state: "available", totalPages: 4, blocks: Array.from({length: 4}, (_,i) => ({ id: `block${i}`, page: i+1, table: null, text: "證據", extractionState: "retained_text", subject: identity.issuer.id, period: null, unit: null })), verifiedClaims: [], provenance };
  const scan: ResearchDisclosureScan = { id: "scan1", listingId: identity.listing.id, issuerId: identity.issuer.id, venue, checkedAt: "2026-09-01T01:59:00.000Z", publicationStart: "2026-09-01T00:00:00.000Z", publicationEnd: context.knowledgeAt, knowledgeAt: context.knowledgeAt, status: "success", exhaustive: false, provenance };
  await persistence.appendResearchAnnouncements([announcement]); await persistence.appendResearchDisclosureArtifacts([artifact]); await persistence.appendResearchDisclosureScans([scan]);
  return { persistence, identity, subject, context, announcement, artifact, scan };
}
async function connect(scope: "research:read" | "portfolio:mcp_read", userId = "user-1") {
  const host = "localhost:4000", resource = "http://localhost:4000/mcp", redirect = "http://localhost:5555/callback";
  const verifier = "disclosure-oauth-verifier-123456789012345678901234567890123456789";
  const resolved = await app.persistence.resolveOrCreateUser("google", userId, { email: `${userId}@example.test`, name: userId });
  const user = await app.persistence.getAuthUserById(resolved.userId);
  const cookie = signSessionCookie(resolved.userId, "disclosure-oauth-session-secret-32-characters", user!.sessionVersion);
  const headers = { host, cookie: `g_auth_session=${cookie}` };
  const authorize = await app.inject({ method: "GET", url: `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: "chatgpt", redirect_uri: redirect, resource, scope, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "disclosure" })}`, headers });
  expect(authorize.statusCode).toBe(302);
  const requestId = new URL(String(authorize.headers.location), "http://localhost:3000").searchParams.get("requestId");
  const consent = await app.inject({ method: "GET", url: `/oauth/consent/${requestId}`, headers });
  expect(consent.statusCode).toBe(200);
  const consentBody = consent.json<{ csrfToken: string; scopes: string[] }>();
  expect(consentBody.scopes).toEqual([scope]);
  const approve = await app.inject({ method: "POST", url: `/oauth/consent/${requestId}/approve`, headers, payload: { csrfToken: consentBody.csrfToken, scopes: [scope], lifetimeDays: 7 } });
  expect(approve.statusCode).toBe(200);
  const bridge = new URL(approve.json<{ redirectUrl: string }>().redirectUrl);
  const redirected = await app.inject({ method: "GET", url: bridge.pathname + bridge.search, headers: { host } });
  expect(redirected.statusCode).toBe(302);
  const code = new URL(String(redirected.headers.location)).searchParams.get("code");
  const token = await app.inject({ method: "POST", url: "/oauth/token", headers: { host, "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams({ grant_type: "authorization_code", code: String(code), redirect_uri: redirect, client_id: "chatgpt", code_verifier: verifier, resource }).toString() });
  expect(token.statusCode).toBe(200);
  const access = token.json<{ access_token: string; scope: string }>();
  expect(access.scope).toBe(scope);
  const mcpHeaders = { host, authorization: `Bearer ${access.access_token}`, accept: "application/json, text/event-stream" };
  const init = await app.inject({ method: "POST", url: "/mcp", headers: mcpHeaders, payload: { jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ChatGPT", version: "1" } } } });
  expect(init.statusCode).toBe(200);
  return async (name: string, args: Record<string, unknown>) => {
    const response = await app.inject({ method: "POST", url: "/mcp", headers: { ...mcpHeaders, "mcp-session-id": String(init.headers["mcp-session-id"]) }, payload: { jsonrpc: "2.0", id: "call", method: "tools/call", params: { name, arguments: args } } });
    expect(response.statusCode).toBe(200);
    const raw = response.body.trim().startsWith("{") ? response.body : response.body.split("\n").find(line => line.startsWith("data: "))!.slice(6);
    return JSON.parse(raw) as { result?: { isError?: boolean; structuredContent?: { result: MaterialAnnouncementsOutput | DisclosureArtifactOutput } }; error?: unknown };
  };
}
describe("OAuth disclosure contract", () => {
  beforeEach(async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, mcpExposureEnabled: true, skillExposureEnabled: true });
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: { clientId: "test-client", clientSecret: "test-secret", redirectUri: "http://localhost/auth/google/callback", sessionSecret: "disclosure-oauth-session-secret-32-characters" }, appBaseUrl: "http://localhost:3000" });
    await app.persistence.setAppConfigEncryptedSecret("mcpOauthTokenSecret", "disclosure-oauth-token-secret-with-32-characters");
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { research: true } });
  });
  afterEach(async () => { vi.restoreAllMocks(); setResearchRolloutOverrideForTest(null); await app.close(); });
  it.each(["TWSE", "TPEX"] as const)("%s research-only OAuth: consent and paginate → canonical evidence without acquisition writes", async venue => {
    const f = await disclosureFixture(app.persistence, venue);
    await app.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "ann2", relations: [{ kind: "retracts", targetAnnouncementId: "ann1" }] }]);
    const call = await connect("research:read");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No provider reads"));
    const writes = [vi.spyOn(app.persistence, "appendResearchAnnouncements"), vi.spyOn(app.persistence, "appendResearchDisclosureArtifacts"), vi.spyOn(app.persistence, "appendResearchDisclosureScans")];
    const first = await call("list_material_announcements", { subject: f.subject, context: f.context, limit: 1 });
    expect(first.result?.isError).not.toBe(true);
    const data = first.result?.structuredContent?.result as MaterialAnnouncementsOutput;
    expect(data.items).toHaveLength(1);
    expect(data.relationIndex).toContainEqual({ announcementId: "ann2", provenanceId: f.announcement.provenance.id, kind: "retracts", targetAnnouncementId: "ann1" });
    expect(data.provenance.find((record) => record.id === data.relationIndex.find((relation) => relation.announcementId === "ann2")?.provenanceId)).toEqual(f.announcement.provenance);
    expect(data.items[0]?.explanation.retainedCharacters).toBe(20000);
    const next = await call("list_material_announcements", { subject: f.subject, cursor: data.page.nextCursor });
    expect((next.result?.structuredContent?.result as MaterialAnnouncementsOutput).items[0]?.id).not.toBe(data.items[0]?.id);
    const artifact = await call("get_disclosure_artifact", { subject: f.subject, context: f.context, artifactId: f.artifact.id });
    expect((artifact.result?.structuredContent?.result as DisclosureArtifactOutput).page.returnedPages).toEqual([1, 2, 3]);
    expect(fetchSpy).not.toHaveBeenCalled(); for (const write of writes) expect(write).not.toHaveBeenCalled();
  });
  it.each(["restricted", "processing_failed", "indeterminate"] as const)("%s artifact: OAuth read → metadata survives and bulk claims withheld", async state => {
    const f = await disclosureFixture(app.persistence);
    await app.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "unavailable_ann", attachments: [{ ...f.announcement.attachments[0]!, artifactId: "unavailable_artifact" }] }]);
    await app.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, id: "unavailable_artifact", reference: { kind: "announcement_attachment", id: "unavailable_ann" }, state, blocks: [{ ...f.artifact.blocks[0]!, text: "PRIVATE_BULK_CONTENT" }] }]);
    const call = await connect("research:read");
    const response = await call("get_disclosure_artifact", { subject: f.subject, context: f.context, artifactId: "unavailable_artifact" });
    expect(response.result?.isError).not.toBe(true);
    const data = response.result?.structuredContent?.result as DisclosureArtifactOutput;
    expect(data.quality.status).toBe(state);
    expect(data.artifact?.blocks).toEqual([]);
    expect(data.artifact?.verifiedClaims).toEqual([]);
    expect(data.artifact?.contentHash).toBe(f.artifact.contentHash);
    expect(JSON.stringify(response)).not.toContain("PRIVATE_BULK_CONTENT");
  });
  it("OAuth principals: replay another user's cursor → authenticated rejection", async () => {
    const f = await disclosureFixture(app.persistence);
    await app.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "ann2" }]);
    const alice = await connect("research:read");
    const first = await alice("list_material_announcements", { subject: f.subject, context: f.context, limit: 1 });
    const cursor = (first.result?.structuredContent?.result as MaterialAnnouncementsOutput).page.nextCursor;
    const bob = await connect("research:read", "user-2");
    const replay = await bob("list_material_announcements", { subject: f.subject, cursor });
    expect(replay.result?.isError).toBe(true); expect(JSON.stringify(replay)).toContain("research_cursor_invalid");
  });
  it("portfolio-only OAuth: request disclosure → scope denial without evidence", async () => {
    const f = await disclosureFixture(app.persistence), call = await connect("portfolio:mcp_read");
    const response = await call("list_material_announcements", { subject: f.subject, context: f.context });
    expect(response.result?.isError === true || response.error !== undefined).toBe(true);
    expect(JSON.stringify(response)).not.toContain(f.announcement.explanation);
  });
  it.each(["TWSE", "TPEX"] as const)("%s public research orchestration: OAuth MCP evidence → focused report with dependent-only withholding", async venue => {
    const fixture = await disclosureFixture(app.persistence, venue);
    const call = await connect("research:read");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No acquisition during research"));
    const calls: string[] = [];
    async function evidence(name: string, args: Record<string, unknown>): Promise<unknown> {
      calls.push(name);
      const response = await call(name, args);
      expect(response.error).toBeUndefined();
      expect(response.result?.isError).not.toBe(true);
      return response.result?.structuredContent?.result;
    }
    const report = await buildFocusedDisclosureResearchReport(app.persistence,
      researchQuerySchema.parse({ subject: fixture.subject, context: fixture.context }), {
        mode: "focused", readBudget: 10,
        candidates: [{ id: "candidate_missing_claim", kind: "risk", status: "conditional", statement: "Disclosed event may affect revenue", statusEvidence: { reference: { kind: "artifact_claim", artifactId: fixture.artifact.id, claimId: "claim_not_verified" }, excerpt: "Disclosed event may affect revenue" }, materialMechanism: "Issuer event changes delivery timing", affectedMetricOrAssumption: "revenue", horizon: "next reporting period", triggeringEvidence: [{ kind: "artifact_claim", artifactId: fixture.artifact.id, claimId: "claim_not_verified" }], confirmingEvidence: [], disconfirmingEvidence: [], confirmationCondition: "A verified filing establishes delay", disconfirmationCondition: "A verified filing establishes on-time delivery", condition: "Delivery delay is verified" }],
      }, {
        getResearchManifestImpl: async (_, query) => researchManifestOutputSchema.parse(await evidence("get_research_manifest", query)),
        getResearchIdentityImpl: async (_, query) => researchIdentityOutputSchema.parse(await evidence("get_research_identity", query)),
        listMaterialAnnouncementsImpl: async (_, query) => materialAnnouncementsOutputSchema.parse(await evidence("list_material_announcements", query)),
        getDisclosureArtifactImpl: async (_, query) => disclosureArtifactOutputSchema.parse(await evidence("get_disclosure_artifact", query)),
      });
    expect(calls).toEqual(["get_research_manifest", "get_research_identity", "list_material_announcements", "get_disclosure_artifact"]);
    expect(report.selector.listingId).toBe(fixture.subject.listingId);
    expect(report.announcementPages[0]?.items[0]?.id).toBe(fixture.announcement.id);
    expect(report.artifactPages[0]?.artifact?.contentHash).toBe(fixture.artifact.contentHash);
    expect(report.assessments[0]?.support).toBe("withheld");
    expect(report.finalRecommendation.state).toBe("not_requested");
    expect(report.window.exhaustive).toBe(false);
    expect(renderFocusedDisclosureResearchReportMarkdown(report)).toContain(fixture.announcement.subject);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
