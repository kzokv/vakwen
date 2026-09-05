import { describe, expect, it, vi } from "vitest";
import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { researchFinancialStatementRecordKey } from "../../src/services/research/financialStatements.js";
import {
  runOfficialFinancialStatementAcquisition,
  OFFICIAL_FINANCIAL_STATEMENT_BASE_URL,
} from "../../src/services/research/acquisition.js";
import {
  buildCurrentMopsFinancialStatementDescriptors,
  createResearchFinancialStatementAcquisitionHandler,
  registerResearchFinancialStatementAcquisitionWorker,
  RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_CRON,
  RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_EXPIRE_SECONDS,
  RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_QUEUE,
} from "../../src/services/research/registerFinancialStatementAcquisitionWorker.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import type { MopsFinancialStatementDescriptor } from "../../src/services/research/providers/mopsXbrl.js";

function acquisitionDescriptor(index: number): MopsFinancialStatementDescriptor {
  return {
    listingId: `lst_${index}`,
    issuerId: `iss_${index}`,
    ticker: String(2300 + index),
    expectedEntityIdentifiers: ["22099131"],
    venue: "TWSE",
    sector: "operating_company",
    sourceUrl: `${OFFICIAL_FINANCIAL_STATEMENT_BASE_URL}?case=${index}`,
    filing: {
      filingId: `q2-2026-${index}`,
      fiscalYear: 2026,
      fiscalPeriod: "q2",
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      filingBasis: "consolidated",
      publishedAt: "2026-08-14",
      revision: 0,
      amendmentType: "original",
    },
  };
}

const validAcquisitionXbrl = `<?xml version="1.0" encoding="utf-8"?>
  <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full" xmlns:custom="https://mops.twse.com.tw/taxonomy/2026/custom">
    <xbrli:context id="duration"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:context id="instant"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <xbrli:unit id="twd"><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit>
    <xbrli:unit id="twd_per_share"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>
    <ifrs-full:Revenue contextRef="duration" unitRef="twd">60</ifrs-full:Revenue>
    <ifrs-full:CashFlowsFromUsedInOperatingActivities contextRef="duration" unitRef="twd">15</ifrs-full:CashFlowsFromUsedInOperatingActivities>
    <ifrs-full:Assets contextRef="instant" unitRef="twd">210</ifrs-full:Assets>
    <custom:EarningsPerShare contextRef="duration" unitRef="twd_per_share">8.5</custom:EarningsPerShare>
  </xbrli:xbrl>`;

describe("research financial statement acquisition", () => {
  it("scheduled fetch: timestamps each artifact after its response is received", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-15T00:00:00.000Z"));
      setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
      const persistence = new MemoryPersistence();
      const appendSpy = vi.spyOn(persistence, "appendResearchFinancialStatementRecords");
      const descriptor = acquisitionDescriptor(0);
      descriptor.filing.amendmentType = "unknown";

      await runOfficialFinancialStatementAcquisition(persistence, {
        descriptors: [descriptor],
        fetchImpl: async () => {
          vi.setSystemTime(new Date("2026-08-15T00:05:00.000Z"));
          return new Response(validAcquisitionXbrl, { status: 200 });
        },
        acquisitionRunId: "per-artifact-observation-run",
      });

      expect(appendSpy.mock.calls[0]?.[0][0]).toHaveProperty(
        "provenance.retrievedAt",
        "2026-08-15T00:05:00.000Z",
      );
      expect(appendSpy.mock.calls[0]?.[0][0]).toHaveProperty(
        "publicationContext.publishedAt",
        "2026-08-15T00:05:00.000Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("universe acquisition: bounds concurrency and persists successes when one filing fails", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    const appendSpy = vi.spyOn(persistence, "appendResearchFinancialStatementRecords");
    const descriptors = Array.from({ length: 6 }, (_, index) => acquisitionDescriptor(index));
    let active = 0;
    let maxActive = 0;
    const fetchImpl: typeof fetch = async (input) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return String(input).endsWith("case=2")
        ? new Response("temporary failure", { status: 503 })
        : new Response(validAcquisitionXbrl, { status: 200 });
    };

    const result = await runOfficialFinancialStatementAcquisition(persistence, {
      descriptors,
      fetchImpl,
      retrievedAt: "2026-08-15T00:00:00.000Z",
      acquisitionRunId: "bounded-partial-run",
    });

    expect(maxActive).toBeLessThanOrEqual(4);
    expect(result).toMatchObject({ sourceCount: 6, recordCount: 5, failureCount: 1 });
    expect(appendSpy).toHaveBeenCalledTimes(5);
    expect(appendSpy.mock.calls.flatMap(([records]) => records)).toEqual(expect.arrayContaining([
      expect.objectContaining({ listingId: "lst_0" }),
      expect.objectContaining({ listingId: "lst_5" }),
    ]));
    expect(appendSpy.mock.calls.every(([records]) => records.length === 1)).toBe(true);
  });

  it("persistence validation failure: isolates one filing and retains successful peers", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    const append = persistence.appendResearchFinancialStatementRecords.bind(persistence);
    vi.spyOn(persistence, "appendResearchFinancialStatementRecords").mockImplementation(async (records) => {
      if (records[0]?.listingId === "lst_1") throw new Error("duplicate fact id");
      await append(records);
    });

    const result = await runOfficialFinancialStatementAcquisition(persistence, {
      descriptors: [acquisitionDescriptor(0), acquisitionDescriptor(1), acquisitionDescriptor(2)],
      fetchImpl: async () => new Response(validAcquisitionXbrl, { status: 200 }),
      retrievedAt: "2026-08-15T00:00:00.000Z",
      acquisitionRunId: "persistence-isolation-run",
    });

    expect(result).toMatchObject({ sourceCount: 3, recordCount: 2, failureCount: 1 });
    expect(result.failures[0]).toMatchObject({ listingId: "lst_1", message: "duplicate fact id" });
    await expect(persistence.listResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId: "lst_0" },
      effectiveAt: "2026-08-15T00:00:00.000Z",
      knowledgeAt: "2026-08-15T00:00:00.000Z",
      periodicity: "quarterly",
    })).resolves.toHaveLength(1);
    await expect(persistence.listResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId: "lst_2" },
      effectiveAt: "2026-08-15T00:00:00.000Z",
      knowledgeAt: "2026-08-15T00:00:00.000Z",
      periodicity: "quarterly",
    })).resolves.toHaveLength(1);
  });

  it("maintenance HTML: rejects an artifact with no required statement facts", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    const appendSpy = vi.spyOn(persistence, "appendResearchFinancialStatementRecords");

    await expect(runOfficialFinancialStatementAcquisition(persistence, {
      descriptors: [acquisitionDescriptor(0)],
      fetchImpl: async () => new Response("<html><body>maintenance</body></html>", { status: 200 }),
      retrievedAt: "2026-08-15T00:00:00.000Z",
      acquisitionRunId: "empty-artifact-run",
    })).rejects.toThrow(/statement facts|required statement roles/i);
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("issuer validation: rejects statement facts belonging to another entity", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    const appendSpy = vi.spyOn(persistence, "appendResearchFinancialStatementRecords");

    await expect(runOfficialFinancialStatementAcquisition(persistence, {
      descriptors: [acquisitionDescriptor(0)],
      fetchImpl: async () => new Response(validAcquisitionXbrl.replaceAll("22099131", "99999999"), { status: 200 }),
      retrievedAt: "2026-08-15T00:00:00.000Z",
      acquisitionRunId: "wrong-issuer-artifact-run",
    })).rejects.toThrow(/entity identifiers do not match/i);
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("period validation: rejects statement facts belonging to another filing period", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    const appendSpy = vi.spyOn(persistence, "appendResearchFinancialStatementRecords");
    const wrongPeriodXbrl = validAcquisitionXbrl
      .replaceAll("2026-04-01", "2025-04-01")
      .replaceAll("2026-06-30", "2025-06-30");

    await expect(runOfficialFinancialStatementAcquisition(persistence, {
      descriptors: [acquisitionDescriptor(0)],
      fetchImpl: async () => new Response(wrongPeriodXbrl, { status: 200 }),
      retrievedAt: "2026-08-15T00:00:00.000Z",
      acquisitionRunId: "wrong-period-artifact-run",
    })).rejects.toThrow(/does not match requested period 2026:q2/i);
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("period validation: accepts year-to-date duration contexts for the requested quarter", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();

    await expect(runOfficialFinancialStatementAcquisition(persistence, {
      descriptors: [acquisitionDescriptor(0)],
      fetchImpl: async () => new Response(
        validAcquisitionXbrl.replaceAll("2026-04-01", "2026-01-01"),
        { status: 200 },
      ),
      retrievedAt: "2026-08-15T00:00:00.000Z",
      acquisitionRunId: "current-cumulative-period-run",
    })).resolves.toMatchObject({ recordCount: 1, failureCount: 0 });
  });

  it("unknown publication time: preserves the exact first-observation timestamp", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    const observedAt = "2026-08-31T17:30:00.000Z";
    await runOfficialFinancialStatementAcquisition(persistence, {
      descriptors: [{
        ...acquisitionDescriptor(1),
        filing: { ...acquisitionDescriptor(1).filing, publishedAt: observedAt },
      }],
      fetchImpl: async () => new Response(validAcquisitionXbrl, { status: 200 }),
      retrievedAt: observedAt,
      acquisitionRunId: "exact-first-observation",
    });

    const records = await persistence.listResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId: "lst_1" },
      effectiveAt: observedAt,
      knowledgeAt: observedAt,
      periodicity: "quarterly",
      filingBasis: "consolidated",
      startPeriod: "2026-Q2",
      endPeriod: "2026-Q2",
    });
    expect(records[0]?.publicationContext.publishedAt).toBe(observedAt);
  });

  it("offset timestamps: memory visibility compares publication and retrieval as instants", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    const offsetInstant = "2026-08-15T08:00:00+08:00";
    await runOfficialFinancialStatementAcquisition(persistence, {
      descriptors: [{
        ...acquisitionDescriptor(1),
        filing: { ...acquisitionDescriptor(1).filing, publishedAt: offsetInstant },
      }],
      fetchImpl: async () => new Response(validAcquisitionXbrl, { status: 200 }),
      retrievedAt: offsetInstant,
      acquisitionRunId: "offset-timestamp-visibility",
    });

    await expect(persistence.listResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId: "lst_1" },
      effectiveAt: "2026-08-15T00:30:00.000Z",
      knowledgeAt: "2026-08-15T00:30:00.000Z",
      periodicity: "quarterly",
      filingBasis: "consolidated",
      startPeriod: "2026-Q2",
      endPeriod: "2026-Q2",
    })).resolves.toHaveLength(1);
  });

  it("changed scheduled artifact: promotes changes and restorations to new amendment revisions with lineage", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    const descriptor = acquisitionDescriptor(0);
    await runOfficialFinancialStatementAcquisition(persistence, {
      descriptors: [descriptor],
      fetchImpl: async () => new Response(validAcquisitionXbrl, { status: 200 }),
      retrievedAt: "2026-08-15T00:00:00.000Z",
    });
    await runOfficialFinancialStatementAcquisition(persistence, {
      descriptors: [{ ...descriptor, filing: { ...descriptor.filing, publishedAt: "2026-08-20" } }],
      fetchImpl: async () => new Response(validAcquisitionXbrl.replace(">60<", ">61<"), { status: 200 }),
      retrievedAt: "2026-08-20T00:00:00.000Z",
    });
    await runOfficialFinancialStatementAcquisition(persistence, {
      descriptors: [{ ...descriptor, filing: { ...descriptor.filing, publishedAt: "2026-08-25" } }],
      fetchImpl: async () => new Response(validAcquisitionXbrl, { status: 200 }),
      retrievedAt: "2026-08-25T00:00:00.000Z",
    });

    const records = await persistence.listResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId: descriptor.listingId },
      effectiveAt: "2026-08-26T00:00:00.000Z",
      knowledgeAt: "2026-08-26T00:00:00.000Z",
      periodicity: "quarterly",
      filingBasis: "consolidated",
      startPeriod: "2026-Q2",
      endPeriod: "2026-Q2",
    });
    const amendment = records.find((record) => record.publicationContext.revisionSequence === 1);
    const original = records.find((record) => record.publicationContext.revisionSequence === 0);
    const restoration = records.find((record) => record.publicationContext.revisionSequence === 2);
    expect(amendment?.publicationContext).toMatchObject({
      amendment: true,
      revisionSequence: 1,
      publishedAt: original?.publicationContext.publishedAt,
    });
    expect(amendment?.publicationContext.revisionPublishedAt?.slice(0, 10)).toBe("2026-08-19");
    expect(amendment?.relations).toEqual([{ kind: "supersedes", targetRecordKey: researchFinancialStatementRecordKey(original!) }]);
    expect(restoration?.publicationContext).toMatchObject({
      amendment: true,
      revisionSequence: 2,
      publishedAt: original?.publicationContext.publishedAt,
    });
    expect(restoration?.publicationContext.revisionPublishedAt?.slice(0, 10)).toBe("2026-08-24");
    expect(restoration?.provenance.contentHash).toBe(original?.provenance.contentHash);
    expect(restoration?.relations).toEqual([{ kind: "supersedes", targetRecordKey: researchFinancialStatementRecordKey(amendment!) }]);
  });

  it("official MOPS acquisition: discrete quarter contexts stay discrete and emitted supersedes keys resolve to stored predecessors", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const q2Revision1Url = `${OFFICIAL_FINANCIAL_STATEMENT_BASE_URL}?co_id=2330&year=2026&season=2&rev=1`;
    const q2Revision2Url = `${OFFICIAL_FINANCIAL_STATEMENT_BASE_URL}?co_id=2330&year=2026&season=2&rev=2`;
    const q3Revision1Url = `${OFFICIAL_FINANCIAL_STATEMENT_BASE_URL}?co_id=2330&year=2026&season=3&rev=1`;
    const payloads = new Map<string, string>([
      [q2Revision1Url, `<?xml version="1.0" encoding="utf-8"?>
        <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full" xmlns:custom="https://mops.twse.com.tw/taxonomy/2026/custom">
          <xbrli:context id="q2"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
          <xbrli:context id="q2i"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
          <xbrli:unit id="twd"><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit>
          <xbrli:unit id="twd_per_share"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>
          <ifrs-full:RevenueFromContractsWithCustomers contextRef="q2" unitRef="twd">30</ifrs-full:RevenueFromContractsWithCustomers>
          <ifrs-full:CashFlowsFromUsedInOperatingActivities contextRef="q2" unitRef="twd">10</ifrs-full:CashFlowsFromUsedInOperatingActivities>
          <ifrs-full:Assets contextRef="q2i" unitRef="twd">50</ifrs-full:Assets>
        </xbrli:xbrl>`],
      [q2Revision2Url, `<?xml version="1.0" encoding="utf-8"?>
        <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full" xmlns:custom="https://mops.twse.com.tw/taxonomy/2026/custom">
          <xbrli:context id="q2"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
          <xbrli:context id="q2i"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
          <xbrli:unit id="twd"><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit>
          <xbrli:unit id="twd_per_share"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>
          <ifrs-full:RevenueFromContractsWithCustomers contextRef="q2" unitRef="twd" scale="3">32</ifrs-full:RevenueFromContractsWithCustomers>
          <ifrs-full:CashFlowsFromUsedInOperatingActivities contextRef="q2" unitRef="twd">11</ifrs-full:CashFlowsFromUsedInOperatingActivities>
          <ifrs-full:Assets contextRef="q2i" unitRef="twd">52</ifrs-full:Assets>
          <custom:EarningsPerShare contextRef="q2" unitRef="twd_per_share">8.5</custom:EarningsPerShare>
          <custom:Revenue contextRef="q2" unitRef="twd">999</custom:Revenue>
        </xbrli:xbrl>`],
      [q3Revision1Url, `<?xml version="1.0" encoding="utf-8"?>
        <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full">
          <xbrli:context id="q3"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-07-01</xbrli:startDate><xbrli:endDate>2026-09-30</xbrli:endDate></xbrli:period></xbrli:context>
          <xbrli:context id="q3i"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-09-30</xbrli:instant></xbrli:period></xbrli:context>
          <xbrli:unit id="twd"><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit>
          <ifrs-full:RevenueFromContractsWithCustomers contextRef="q3" unitRef="twd">48</ifrs-full:RevenueFromContractsWithCustomers>
          <ifrs-full:CashFlowsFromUsedInOperatingActivities contextRef="q3" unitRef="twd">17</ifrs-full:CashFlowsFromUsedInOperatingActivities>
          <ifrs-full:Assets contextRef="q3i" unitRef="twd">61</ifrs-full:Assets>
        </xbrli:xbrl>`],
    ]);
    const fetchImpl: typeof fetch = async (input) => new Response(payloads.get(String(input)), { status: 200 });
    const persistence = new MemoryPersistence();

    await runOfficialFinancialStatementAcquisition(persistence, {
      descriptors: [
        {
          listingId: "lst_2330",
          issuerId: "iss_2330",
          ticker: "2330",
          expectedEntityIdentifiers: ["22099131"],
          venue: "TWSE",
          sector: "operating_company",
          sourceUrl: q2Revision1Url,
          filing: {
            filingId: "q2-2026",
            fiscalYear: 2026,
            fiscalPeriod: "q2",
            periodStart: "2026-04-01",
            periodEnd: "2026-06-30",
            filingBasis: "consolidated",
            publishedAt: "2026-08-14",
            revision: 1,
            amendmentType: "original",
          },
        },
      ],
      fetchImpl,
      retrievedAt: "2026-08-15T00:00:00.000Z",
      acquisitionRunId: "financial-statements-acquisition-q2-r1",
    });

    await runOfficialFinancialStatementAcquisition(persistence, {
      descriptors: [
        {
          listingId: "lst_2330",
          issuerId: "iss_2330",
          ticker: "2330",
          expectedEntityIdentifiers: ["22099131"],
          venue: "TWSE",
          sector: "operating_company",
          sourceUrl: q2Revision2Url,
          filing: {
            filingId: "q2-2026",
            fiscalYear: 2026,
            fiscalPeriod: "q2",
            periodStart: "2026-04-01",
            periodEnd: "2026-06-30",
            filingBasis: "consolidated",
            publishedAt: "2026-08-20",
            revision: 2,
            amendmentType: "restatement",
          },
        },
        {
          listingId: "lst_2330",
          issuerId: "iss_2330",
          ticker: "2330",
          expectedEntityIdentifiers: ["22099131"],
          venue: "TWSE",
          sector: "operating_company",
          sourceUrl: q3Revision1Url,
          filing: {
            filingId: "q3-2026",
            fiscalYear: 2026,
            fiscalPeriod: "q3",
            periodStart: "2026-07-01",
            periodEnd: "2026-09-30",
            filingBasis: "consolidated",
            publishedAt: "2026-11-14",
            revision: 1,
            amendmentType: "original",
          },
        },
      ],
      fetchImpl,
      retrievedAt: "2026-11-15T00:00:00.000Z",
      acquisitionRunId: "financial-statements-acquisition-q2-r2-q3-r1",
    });

    const q2Records = await persistence.listResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId: "lst_2330" },
      effectiveAt: "2026-12-01T00:00:00.000Z",
      knowledgeAt: "2026-12-01T00:00:00.000Z",
      periodicity: "quarterly",
      startPeriod: "2026-Q2",
      endPeriod: "2026-Q2",
      filingBasis: "consolidated",
    });
    const q3Records = await persistence.listResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId: "lst_2330" },
      effectiveAt: "2026-12-01T00:00:00.000Z",
      knowledgeAt: "2026-12-01T00:00:00.000Z",
      periodicity: "quarterly",
      startPeriod: "2026-Q3",
      endPeriod: "2026-Q3",
      filingBasis: "consolidated",
    });

    const q2Latest = q2Records.find((record) => record.publicationContext.revisionSequence === 2);
    const q3Latest = q3Records.find((record) => record.publicationContext.revisionSequence === 1);
    expect(q2Latest).toBeDefined();
    expect(q3Latest).toBeDefined();
    expect(q2Latest?.statements.flatMap((section) => section.facts)
      .filter((fact) => fact.context.period.kind === "duration")
      .every((fact) => fact.context.valueKind === "discrete")).toBe(true);
    expect(q3Latest?.statements.flatMap((section) => section.facts)
      .filter((fact) => fact.context.period.kind === "duration")
      .every((fact) => fact.context.valueKind === "discrete")).toBe(true);
    const transformedRevenue = q2Latest?.statements.flatMap((section) => section.facts)
      .find((fact) => fact.metric.state === "mapped" && fact.metric.metricId === "revenue");
    expect(transformedRevenue?.raw).toEqual({ state: "present", value: "32" });
    expect(transformedRevenue?.normalized).toEqual({ state: "present", value: "32000" });
    expect(transformedRevenue?.taxonomy).toEqual({
      namespaceUri: "http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full",
      version: "2026-03",
    });
    const earningsPerShare = q2Latest?.statements.flatMap((section) => section.facts)
      .find((fact) => fact.concept.qname === "custom:EarningsPerShare");
    expect(earningsPerShare?.unit).toEqual({
      state: "known",
      unitId: "{http://www.xbrl.org/2003/iso4217}TWD/{http://www.xbrl.org/2003/instance}shares",
    });
    const extensionRevenue = q2Latest?.statements.flatMap((section) => section.facts)
      .find((fact) => fact.concept.qname === "custom:Revenue");
    expect(extensionRevenue?.metric).toEqual({ state: "unmapped", reason: "no_core_metric_mapping" });

    const predecessor = q2Records.find((record) => record.publicationContext.revisionSequence === 1);
    expect(predecessor).toBeDefined();
    expect(q2Latest?.relations).toEqual([
      {
        kind: "supersedes",
        targetRecordKey: researchFinancialStatementRecordKey(predecessor!),
      },
    ]);
    const storedKeys = new Set(q2Records.map((record) => researchFinancialStatementRecordKey(record)));
    expect(q2Latest?.relations.every((relation) => storedKeys.has(relation.targetRecordKey))).toBe(true);
  });

  it("worker registration: queue and cron stay explicit, and handler resolves descriptors at run time", async () => {
    expect(RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_EXPIRE_SECONDS).toBe(12 * 60 * 60);
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      work: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue(undefined),
    };
    const resolveDescriptors = vi.fn().mockResolvedValue([]);

    await registerResearchFinancialStatementAcquisitionWorker(boss as never, {
      persistence: { appendResearchFinancialStatementRecords: vi.fn() } as never,
      log: { info: vi.fn() } as never,
      resolveDescriptors,
    });

    expect(boss.createQueue).toHaveBeenCalledWith(
      RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_QUEUE,
      expect.objectContaining({
        expireInSeconds: RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_EXPIRE_SECONDS,
        policy: "singleton",
      }),
    );
    expect(boss.schedule).toHaveBeenCalledWith(
      RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_QUEUE,
      RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_CRON,
      {},
    );
    const handler = createResearchFinancialStatementAcquisitionHandler({
      persistence: { appendResearchFinancialStatementRecords: vi.fn().mockResolvedValue(undefined) } as never,
      log: { info: vi.fn() } as never,
      resolveDescriptors,
    });
    await expect(handler([{ id: "job-1" } as never])).resolves.toBeUndefined();
    expect(resolveDescriptors).toHaveBeenCalled();
  });

  it("scheduled descriptor resolution: active operating companies map to the latest due MOPS filing", () => {
    const identity = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-09-01",
      retrievedAt: "2026-09-01T00:00:00.000Z",
      artifact: { contentHash: "sha256:identity", sourceUrl: "https://openapi.twse.com.tw/company" },
      row: {
        kind: "company",
        ticker: "2330",
        legalName: "台灣積體電路製造股份有限公司",
        displayName: "台積電",
        unifiedBusinessNumber: "22099131",
        industryCode: "24",
        listedAt: "1994-09-05",
      },
    });

    const descriptors = buildCurrentMopsFinancialStatementDescriptors(
      [identity],
      new Date("2026-09-01T00:00:00.000Z"),
    );

    expect(descriptors).toHaveLength(22);
    expect(descriptors).toContainEqual(
      expect.objectContaining({
        listingId: identity.listing.id,
        issuerId: identity.issuer.id,
        ticker: "2330",
        expectedEntityIdentifiers: ["22099131"],
        venue: "TWSE",
        sector: "operating_company",
        sourceUrl: expect.stringMatching(/functionName=t164sb01&step=9&co_id=2330&year=115&season=2&report_id=C/),
        filing: expect.objectContaining({
          fiscalYear: 2026,
          fiscalPeriod: "q2",
          periodStart: "2026-04-01",
          periodEnd: "2026-06-30",
          filingBasis: "consolidated",
          publishedAt: "2026-09-01T00:00:00.000Z",
        }),
      }),
    );
    expect(descriptors).toContainEqual(
      expect.objectContaining({
        sourceUrl: expect.stringMatching(/functionName=t164sb01&step=9&co_id=2330&year=115&season=2&report_id=A/),
        filing: expect.objectContaining({
          fiscalYear: 2026,
          fiscalPeriod: "q2",
          filingBasis: "individual",
        }),
      }),
    );
    expect(descriptors.filter((descriptor) => descriptor.filing.fiscalPeriod === "annual")
      .map((descriptor) => descriptor.filing.fiscalYear)).toEqual([2023, 2023, 2024, 2024, 2025, 2025]);
    expect(descriptors.filter((descriptor) => descriptor.filing.fiscalPeriod !== "annual")).toHaveLength(16);

    const financialIdentity = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-09-01",
      retrievedAt: "2026-09-01T00:00:00.000Z",
      artifact: { contentHash: "sha256:financial-identity", sourceUrl: "https://openapi.twse.com.tw/company" },
      row: {
        kind: "company",
        ticker: "2882",
        legalName: "國泰金融控股股份有限公司",
        displayName: "國泰金",
        unifiedBusinessNumber: "03374707",
        industryCode: "17",
        listedAt: "2001-12-31",
      },
    });
    expect(buildCurrentMopsFinancialStatementDescriptors(
      [financialIdentity],
      new Date("2026-09-01T00:00:00.000Z"),
    ).every((descriptor) => descriptor.sector === "financial_institution")).toBe(true);

    const afterMidnightTaiwan = buildCurrentMopsFinancialStatementDescriptors(
      [identity],
      new Date("2026-08-31T17:30:00.000Z"),
    );
    expect(afterMidnightTaiwan.every((descriptor) => descriptor.filing.publishedAt === "2026-08-31T17:30:00.000Z"))
      .toBe(true);

    const latestTarget = (instant: string) => {
      const targets = buildCurrentMopsFinancialStatementDescriptors([identity], new Date(instant));
      const latestQuarter = targets
        .filter((descriptor) => descriptor.filing.fiscalPeriod !== "annual")
        .sort((left, right) => right.filing.periodEnd.localeCompare(left.filing.periodEnd))[0];
      const latestAnnualYear = Math.max(...targets
        .filter((descriptor) => descriptor.filing.fiscalPeriod === "annual")
        .map((descriptor) => descriptor.filing.fiscalYear));
      return { latestQuarter: latestQuarter?.filing.fiscalPeriod, latestAnnualYear };
    };
    expect(latestTarget("2026-03-30T17:30:00.000Z")).toEqual({ latestQuarter: "q3", latestAnnualYear: 2024 });
    expect(latestTarget("2026-03-31T17:30:00.000Z")).toEqual({ latestQuarter: "q4", latestAnnualYear: 2025 });
    expect(latestTarget("2026-05-14T17:30:00.000Z").latestQuarter).toBe("q4");
    expect(latestTarget("2026-05-15T17:30:00.000Z").latestQuarter).toBe("q1");
    expect(latestTarget("2026-08-13T17:30:00.000Z").latestQuarter).toBe("q1");
    expect(latestTarget("2026-08-14T17:30:00.000Z").latestQuarter).toBe("q2");
    expect(latestTarget("2026-11-13T17:30:00.000Z").latestQuarter).toBe("q2");
    expect(latestTarget("2026-11-14T17:30:00.000Z").latestQuarter).toBe("q3");

    const postAnnualDue = buildCurrentMopsFinancialStatementDescriptors(
      [identity],
      new Date("2026-04-15T00:00:00.000Z"),
    );
    expect(postAnnualDue.filter((descriptor) => descriptor.filing.fiscalPeriod !== "annual")).toContainEqual(
      expect.objectContaining({ filing: expect.objectContaining({ fiscalYear: 2025, fiscalPeriod: "q4", periodEnd: "2025-12-31" }) }),
    );
  });
});
