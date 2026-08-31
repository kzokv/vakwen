import { afterEach, describe, expect, it } from "vitest";
import { listMcpToolDefinitions, setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";
import {
  researchMonthlyRevenueToolOutputSchema,
  researchPriceSeriesToolOutputSchema,
  researchToolErrorOutputSchema,
} from "../../src/services/research/contracts.js";

describe("Taiwan research MCP tool contracts", () => {
  afterEach(() => setResearchRolloutOverrideForTest(null));

  it("research MCP rollout: enable acquisition and MCP exposure → list manifest and identity first with concrete schemas", () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, mcpExposureEnabled: true });

    const tools = listMcpToolDefinitions();
    expect(tools.slice(0, 4).map((tool) => tool.name)).toEqual([
      "get_research_manifest",
      "get_research_identity",
      "get_price_series",
      "get_monthly_revenue",
    ]);
    for (const toolName of ["get_research_manifest", "get_research_identity", "get_price_series", "get_monthly_revenue"] as const) {
      const tool = tools.find((item) => item.name === toolName)!;
      expect(tool.scope).toBe("research:read");
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      expect(tool.outputSchema.safeParse("not-structured-content").success).toBe(false);
      const structuredError = {
        code: "research_subject_not_found",
        message: "No canonical research identity matched the selector",
        statusCode: 404,
      };
      expect(researchToolErrorOutputSchema.parse(structuredError)).toEqual(structuredError);
      expect(tool.outputSchema.safeParse({ result: structuredError }).success).toBe(true);
      expect(tool.outputSchema.safeParse(structuredError).success).toBe(false);
      expect(tool.outputSchema.safeParse({}).success).toBe(false);
      expect(tool.outputSchema.safeParse({ result: {} }).success).toBe(false);
      expect(tool.outputSchema.safeParse({
        result: {
          ...structuredError,
          contractVersion: "research-invalid/1.0.0",
        },
      }).success).toBe(false);
      for (const sharedCode of [
        "mcp_rate_limited",
        "mcp_tool_group_disabled",
        "mcp_tool_disabled",
      ]) {
        expect(tool.outputSchema.safeParse({
          result: {
            code: sharedCode,
            message: "Shared MCP policy denied the tool call",
            statusCode: sharedCode === "mcp_rate_limited" ? 429 : 403,
          },
        }).success).toBe(true);
      }
    }
    const priceSeriesTool = tools.find((tool) => tool.name === "get_price_series")!;
    expect(priceSeriesTool.outputSchema).toBe(researchPriceSeriesToolOutputSchema);
  });

  it("monthly revenue output schema: accept wrapped structured results and reject bare payloads", () => {
    const calendarError = {
      result: {
        code: "research_calendar_unavailable",
        message: "Authoritative Taiwan market calendar is unavailable for 2026",
        statusCode: 422,
        metadata: { calendarYear: 2026 },
      },
    };
    expect(researchMonthlyRevenueToolOutputSchema.parse(calendarError)).toEqual(calendarError);

    const structured = {
      result: {
        contractVersion: "monthly-revenue/1.0.0",
        selector: { kind: "listing_id", listingId: "lst_demo" },
        context: {
          knowledgeAt: "2026-08-28T00:00:00.000Z",
          effectiveAt: "2026-08-28T00:00:00.000Z",
          assessmentMode: "effective",
        },
        window: {
          startMonth: "2025-08",
          endMonth: "2026-07",
          requestedOrder: "desc",
          pageLimit: 24,
          defaultMonths: 24,
          maxMonths: 120,
        },
        freshness: {
          basis: "standard_10th",
          gracePolicy: "next_taiwan_business_day",
          latestExpectedMonth: "2026-07",
          statutoryDueDate: "2026-08-10",
          latestDueStatus: "reported",
        },
        conclusion: {
          status: "withheld",
          statement: "Monthly revenue conclusion withheld because the current window does not pass the required comparability gates.",
          reasonCodes: ["not_acquired"],
        },
        items: [],
        page: { nextCursor: null },
        evidence: { provenanceIds: [] },
      },
    };
    expect(researchMonthlyRevenueToolOutputSchema.safeParse(structured).success).toBe(true);
    expect(researchMonthlyRevenueToolOutputSchema.safeParse(structured.result).success).toBe(false);
  });

  it("monthly revenue output schema: preserve source-fact comparisons separately from derived metrics", () => {
    const structured = {
      result: {
        contractVersion: "monthly-revenue/1.0.0",
        selector: { kind: "listing_id", listingId: "lst_demo" },
        context: {
          knowledgeAt: "2026-08-28T00:00:00.000Z",
          effectiveAt: "2026-08-28T00:00:00.000Z",
          assessmentMode: "effective",
        },
        window: {
          startMonth: "2025-08",
          endMonth: "2026-07",
          requestedOrder: "desc",
          pageLimit: 24,
          defaultMonths: 24,
          maxMonths: 120,
        },
        freshness: {
          basis: "standard_10th",
          gracePolicy: "next_taiwan_business_day",
          latestExpectedMonth: "2026-07",
          statutoryDueDate: "2026-08-10",
          latestDueStatus: "missing",
        },
        conclusion: {
          status: "withheld",
          statement: "Monthly revenue conclusion withheld because the latest due month 2026-07 is not yet present in the canonical store.",
          reasonCodes: ["latest_due_gap"],
        },
        items: [{
          revenueMonth: "2026-07",
          publicationContext: {
            publishedAt: "2026-08-10",
            rawPublishedAt: "1150810",
            declaredUnit: "UNKNOWN",
            basis: "consolidated",
            qualifier: "estimated",
          },
          sourceFacts: {
            companyName: "測試公司",
            industryName: "半導體業",
            currentMonthRevenue: { raw: "1,000", normalized: { state: "present", value: "1000" } },
            priorMonthRevenue: { raw: "990", normalized: { state: "present", value: "990" } },
            priorYearSameMonthRevenue: { raw: "900", normalized: { state: "present", value: "900" } },
            publisherComparisons: {
              monthOverMonthPercent: { raw: "1.01", normalized: { state: "present", value: "1.01" } },
              yearOverYearPercent: { raw: "11.11", normalized: { state: "present", value: "11.11" } },
              currentYearToDateRevenue: { raw: "7,000", normalized: { state: "present", value: "7000" } },
              priorYearToDateRevenue: { raw: "6,300", normalized: { state: "present", value: "6300" } },
              yearToDateYearOverYearPercent: { raw: "11.11", normalized: { state: "present", value: "11.11" } },
            },
            note: "自結數",
          },
          basisChange: {
            state: "absent",
            reasonCode: null,
          },
          derivedMetrics: {
            yearOverYearPercent: { status: "withheld", reasonCode: "unknown_unit", lineageMonths: ["2025-07", "2026-07"] },
            rolling3MonthRevenue: { status: "withheld", reasonCode: "short_window", lineageMonths: ["2026-05", "2026-06", "2026-07"] },
            trailing12MonthRevenue: { status: "withheld", reasonCode: "short_window", lineageMonths: ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"] },
            currentYearToDateRevenue: { status: "available", value: "7000", lineageMonths: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"] },
            priorYearToDateRevenue: { status: "available", value: "6300", lineageMonths: ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07"] },
            yearToDateYearOverYearPercent: { status: "available", value: "11.111111", lineageMonths: ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"] },
            seasonalityShareOfTrailing12MonthRevenue: { status: "withheld", reasonCode: "short_window", lineageMonths: ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"] },
          },
        }],
        page: { nextCursor: null },
        evidence: { provenanceIds: ["prv_demo"] },
      },
    };

    expect(researchMonthlyRevenueToolOutputSchema.parse(structured)).toEqual(structured);
  });
});
