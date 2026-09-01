import { describe, expect, it } from "vitest";
import {
  researchFinancialStatementsQuerySchema,
  researchFinancialStatementsToolOutputSchema,
} from "../../src/services/research/contracts.js";

describe("research financial-statement contracts", () => {
  it("defaults annual financial-statement reads to the latest three periods with the core statement set", () => {
    const query = researchFinancialStatementsQuerySchema.parse({
      subject: { kind: "listing_id", listingId: "lst_demo" },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
    });

    expect(query).toMatchObject({
      periodicity: "annual",
      range: { kind: "latest_periods", count: 3 },
      filingBasis: "policy_selected",
      statements: ["income", "balance_sheet", "cash_flow"],
      page: { limit: 3, order: "desc" },
      metricSelection: { base: "required_core", groups: [], explicitMetricIds: [] },
      derivedMetrics: [],
    });
  });

  it("caps annual page size at ten periods and keeps derived-metric requests unique", () => {
    expect(() => researchFinancialStatementsQuerySchema.parse({
      subject: { kind: "listing_id", listingId: "lst_demo" },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      page: { limit: 11, order: "desc" },
      derivedMetrics: [
        { metricId: "gross_margin", parameters: {} },
        { metricId: "gross_margin", parameters: {} },
      ],
    })).toThrow();
  });

  it("rejects an empty statement selection at the query boundary", () => {
    expect(() => researchFinancialStatementsQuerySchema.parse({
      subject: { kind: "listing_id", listingId: "lst_demo" },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      statements: [],
    })).toThrow();
  });

  it("rejects request shapes that can exceed derived-outcome capacity", () => {
    expect(() => researchFinancialStatementsQuerySchema.parse({
      subject: { kind: "listing_id", listingId: "lst_demo" },
      context: { knowledgeAt: "2026-09-01T00:00:00.000Z", effectiveAt: "2026-09-01T00:00:00.000Z", assessmentMode: "effective" },
      periodicity: "quarterly",
      page: { limit: 20, order: "desc" },
      derivedMetrics: Array.from({ length: 11 }, (_, index) => ({
        metricId: "gross_margin",
        parameters: { variant: index },
      })),
    })).toThrow(/must not exceed 200 outcomes/);
  });

  it("accepts only wrapped structured tool results", () => {
    const structured = {
      result: {
        contractVersion: "research-financial-statements/1.0.0",
        selector: { kind: "listing_id", listingId: "lst_demo" },
        context: {
          knowledgeAt: "2026-09-01T00:00:00.000Z",
          effectiveAt: "2026-09-01T00:00:00.000Z",
          assessmentMode: "effective",
        },
        identity: {
          issuer: { id: "iss_demo", classification: "operating_company" },
          security: { id: "sec_demo", issuerId: "iss_demo", type: "common_equity", rights: "common_shares" },
          listing: {
            id: "lst_demo",
            securityId: "sec_demo",
            venue: "TWSE",
            ticker: "2330",
            listedAt: "1994-09-05",
            status: "active",
          },
          displayName: "台積電",
          eligibility: { profile: "operating_company", state: "eligible", reasonCode: "operating_company" },
          availability: { status: "eligible", reasonCode: "operating_company" },
        },
        periodicity: "annual",
        range: { kind: "latest_periods", count: 3 },
        basisPolicy: {
          requested: "policy_selected",
          selected: "consolidated",
          policyId: "mops-xbrl-basis-selection/1.0.0",
          fallbackApplied: false,
        },
        statements: ["income", "balance_sheet", "cash_flow"],
        metricSelection: { base: "required_core", groups: [], explicitMetricIds: [] },
        derivedMetricRequests: [],
        coverage: { status: "complete", requestedPeriodCount: 3, returnedPeriodCount: 1 },
        freshness: { state: "current", authoritativeAsOf: "2025-12-31", latestAcceptedAt: "2026-03-15T10:00:00.000Z" },
        completeness: { status: "complete", missingFactCount: 0, missingMetricCount: 0 },
        confidence: { status: "high", reasonCodes: [] },
        readiness: { status: "ready", reasonCodes: [] },
        periods: [],
        derivedOutcomes: [],
        gaps: [],
        conflicts: [],
        recovery: [],
        provenanceIndex: [],
        page: { limit: 3, order: "desc", nextCursor: null, recordCount: 0, truncatedByBudget: false },
      },
    };

    expect(researchFinancialStatementsToolOutputSchema.safeParse(structured).success).toBe(true);
    expect(researchFinancialStatementsToolOutputSchema.safeParse(structured.result).success).toBe(false);
  });
});
