import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppInstance } from "../../src/app.js";
import type { MemoryPersistence } from "../../src/persistence/memory.js";
import type { McpRequestContext } from "../../src/mcp/types.js";
import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";

let app: AppInstance;

function createRequestContext(scopes: Array<"portfolio:mcp_read" | "research:read">): McpRequestContext {
  return {
    auth: {
      token: "vakwen-dev.test",
      clientId: "vakwen-dev-client",
      sessionUserId: "user-1",
      connection: null,
      scopes,
      toolToggles: {},
      expiresAt: null,
      authMode: "dev_token",
    },
    resolvedContext: {
      sessionUserId: "user-1",
      portfolioContextUserId: "user-1",
      shareId: null,
      shareCapabilities: [],
    },
    requestId: "mcp-portfolio-read-research-test",
    sourceIp: "127.0.0.1",
    userAgent: "vitest",
    logger: app.log,
  };
}

describe("mcp portfolio research search", () => {
  beforeEach(async () => {
    setResearchRolloutOverrideForTest({ mcpExposureEnabled: true });
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp({ persistenceBackend: "memory", seedMemoryCatalog: true });
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { research: true },
    });
  });

  afterEach(async () => {
    setResearchRolloutOverrideForTest(null);
    await app.close();
  });

  it("research-only search defaults to TW and can include inactive rows with additive researchIdentity", async () => {
    const { searchInstruments } = await import("../../src/services/mcpPortfolioRead.js");
    const persistence = app.persistence as MemoryPersistence;
    persistence._seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    persistence._seedInstrument({
      ticker: "9105",
      name: "Delisted TW",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "failed",
      delistedAt: "2026-08-01T00:00:00.000Z",
    });
    persistence._seedInstrument({
      ticker: "TSLA",
      name: "Tesla",
      instrumentType: "STOCK",
      marketCode: "US",
      barsBackfillStatus: "ready",
    });

    const result = await searchInstruments(
      {
        app,
        requestContext: createRequestContext(["research:read"]),
        tradingCalendar: {
          latestSettledTradingDay: async () => "2026-08-28",
          isTradingDay: async () => true,
        } as never,
      },
      { query: "T", limit: 10, includeInactive: true },
    );

    expect(result.markets).toEqual(["TW"]);
    expect(result.items.every((item) => item.marketCode === "TW")).toBe(true);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ticker: "2330",
        researchIdentity: { availability: "available" },
      }),
      expect.objectContaining({
        ticker: "9105",
        researchIdentity: { availability: "unavailable" },
      }),
    ]));
  });

  it("research-only search rejects non-TW markets instead of coercing them", async () => {
    const { searchInstruments } = await import("../../src/services/mcpPortfolioRead.js");

    await expect(searchInstruments(
      {
        app,
        requestContext: createRequestContext(["research:read"]),
        tradingCalendar: {
          latestSettledTradingDay: async () => "2026-08-28",
          isTradingDay: async () => true,
        } as never,
      },
      { query: "Apple", limit: 10, markets: ["US"] as never },
    )).rejects.toMatchObject({
      statusCode: 400,
      code: "mcp_research_market_unsupported",
    });
  });

  it("combined read and research scopes keep legacy multi-market search and add researchIdentity only where applicable", async () => {
    const { searchInstruments } = await import("../../src/services/mcpPortfolioRead.js");
    const persistence = app.persistence as MemoryPersistence;
    persistence._seedInstrument({
      ticker: "2330",
      name: "Tesla Taiwan",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    persistence._seedInstrument({
      ticker: "TSLA",
      name: "Tesla",
      instrumentType: "STOCK",
      marketCode: "US",
      barsBackfillStatus: "ready",
    });

    const result = await searchInstruments(
      {
        app,
        requestContext: createRequestContext(["portfolio:mcp_read", "research:read"]),
        tradingCalendar: {
          latestSettledTradingDay: async () => "2026-08-28",
          isTradingDay: async () => true,
        } as never,
      },
      { query: "Tesla", limit: 100, markets: ["TW", "US"] as never },
    );

    expect(result.markets).toEqual(["TW", "US"]);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ticker: "2330",
        marketCode: "TW",
        researchIdentity: { availability: "available" },
      }),
      expect.objectContaining({
        ticker: "TSLA",
        marketCode: "US",
        researchIdentity: { availability: "not_applicable" },
      }),
    ]));
  });

  it("portfolio-only scope cannot opt into inactive rows or researchIdentity when research rollout is enabled", async () => {
    const { searchInstruments } = await import("../../src/services/mcpPortfolioRead.js");
    const persistence = app.persistence as MemoryPersistence;
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { read: true, research: true },
    });
    persistence._seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    persistence._seedInstrument({
      ticker: "9105",
      name: "Delisted TW",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "failed",
      delistedAt: "2026-08-01T00:00:00.000Z",
    });

    const result = await searchInstruments(
      {
        app,
        requestContext: createRequestContext(["portfolio:mcp_read"]),
        tradingCalendar: {
          latestSettledTradingDay: async () => "2026-08-28",
          isTradingDay: async () => true,
        } as never,
      },
      { query: "T", limit: 10, markets: ["TW"], includeInactive: true },
    );

    expect(result.items.map((item) => item.ticker)).toContain("2330");
    expect(result.items.map((item) => item.ticker)).not.toContain("9105");
    expect(result.items.every((item) => !("researchIdentity" in item))).toBe(true);
  });

  it("combined scopes fall back to research-only search when the read group is disabled", async () => {
    const { searchInstruments } = await import("../../src/services/mcpPortfolioRead.js");
    const persistence = app.persistence as MemoryPersistence;
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { read: false, research: true },
    });
    persistence._seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    persistence._seedInstrument({
      ticker: "TSLA",
      name: "Tesla",
      instrumentType: "STOCK",
      marketCode: "US",
      barsBackfillStatus: "ready",
    });

    const result = await searchInstruments(
      {
        app,
        requestContext: createRequestContext(["portfolio:mcp_read", "research:read"]),
        tradingCalendar: {
          latestSettledTradingDay: async () => "2026-08-28",
          isTradingDay: async () => true,
        } as never,
      },
      { query: "T", limit: 100 },
    );

    expect(result.markets).toEqual(["TW"]);
    expect(result.items.every((item) => item.marketCode === "TW")).toBe(true);
  });

  it("combined scopes still reject non-TW markets when policy forces the research path", async () => {
    const { searchInstruments } = await import("../../src/services/mcpPortfolioRead.js");
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { read: false, research: true },
    });

    await expect(searchInstruments(
      {
        app,
        requestContext: createRequestContext(["portfolio:mcp_read", "research:read"]),
        tradingCalendar: {
          latestSettledTradingDay: async () => "2026-08-28",
          isTradingDay: async () => true,
        } as never,
      },
      { query: "Tesla", limit: 10, markets: ["TW", "US"] as never },
    )).rejects.toMatchObject({
      statusCode: 400,
      code: "mcp_research_market_unsupported",
    });
  });
});
