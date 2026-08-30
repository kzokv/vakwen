import { describe, expect, it } from "vitest";
import { researchPriceSeriesQuerySchema, researchQuerySchema } from "../../src/services/research/contracts.js";

describe("Taiwan research contracts", () => {
  it("listing selector: parse a leading-zero ticker → preserve the ticker and fix effectiveAt to knowledgeAt", () => {
    const query = researchQuerySchema.parse({
      subject: {
        kind: "ticker_venue",
        ticker: "0050",
        listingVenue: "TWSE",
      },
      context: {
        knowledgeAt: "2026-08-28T02:00:00.000Z",
      },
    });

    expect(query).toEqual({
      subject: {
        kind: "ticker_venue",
        ticker: "0050",
        listingVenue: "TWSE",
      },
      context: {
        assessmentMode: "effective",
        effectiveAt: "2026-08-28T02:00:00.000Z",
        knowledgeAt: "2026-08-28T02:00:00.000Z",
      },
    });
  });

  it("offset context: normalize both instants to UTC → keep memory and Postgres temporal comparisons equivalent", () => {
    const query = researchQuerySchema.parse({
      subject: { kind: "ticker_venue", ticker: "2330", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2026-08-28T08:00:00+08:00",
        effectiveAt: "2026-08-28T07:00:00+08:00",
      },
    });

    expect(query.context).toMatchObject({
      knowledgeAt: "2026-08-28T00:00:00.000Z",
      effectiveAt: "2026-08-27T23:00:00.000Z",
    });
  });

  it("strict selector and context: reject coercion, mixed selectors, future effective time, and unversioned re-evaluation", () => {
    const context = { knowledgeAt: "2026-08-28T00:00:00.000Z" };
    expect(() => researchQuerySchema.parse({
      subject: { kind: "ticker_venue", ticker: 50, listingVenue: "TWSE" },
      context,
    })).toThrow();
    expect(() => researchQuerySchema.parse({
      subject: { kind: "listing_id", listingId: "lst_abc", ticker: "0050" },
      context,
    })).toThrow();
    expect(() => researchQuerySchema.parse({
      subject: { kind: "ticker_venue", ticker: "0050", listingVenue: "UNKNOWN" },
      context,
    })).toThrow();
    expect(() => researchQuerySchema.parse({
      subject: { kind: "ticker_venue", ticker: "0050", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-29T00:00:00.000Z",
      },
    })).toThrow();
    expect(() => researchQuerySchema.parse({
      subject: { kind: "ticker_venue", ticker: "0050", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "re_evaluate",
      },
    })).toThrow();
  });

  it.each(["2026-13-01", "2026-02-31"])(
    "price-series date range: reject impossible calendar date %s at the request boundary",
    (invalidDate) => {
      const result = researchPriceSeriesQuerySchema.safeParse({
        subject: { kind: "ticker_venue", ticker: "2330", listingVenue: "TWSE" },
        context: { knowledgeAt: "2026-08-28T00:00:00.000Z" },
        scope: { kind: "date_range", startDate: invalidDate, endDate: invalidDate },
      });

      expect(result.success).toBe(false);
    },
  );
});
