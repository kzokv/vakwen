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
  <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full">
    <xbrli:context id="duration"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:context id="instant"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
    <xbrli:unit id="twd"><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit>
    <ifrs-full:Revenue contextRef="duration" unitRef="twd">60</ifrs-full:Revenue>
    <ifrs-full:CashFlowsFromUsedInOperatingActivities contextRef="duration" unitRef="twd">15</ifrs-full:CashFlowsFromUsedInOperatingActivities>
    <ifrs-full:Assets contextRef="instant" unitRef="twd">210</ifrs-full:Assets>
  </xbrli:xbrl>`;

describe("research financial statement acquisition", () => {
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
    expect(appendSpy).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ listingId: "lst_0" }),
      expect.objectContaining({ listingId: "lst_5" }),
    ]));
    expect(appendSpy.mock.calls[0]?.[0]).toHaveLength(5);
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

  it("changed scheduled artifact: promotes the content to an amendment revision with lineage", async () => {
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

    const records = await persistence.listResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId: descriptor.listingId },
      effectiveAt: "2026-08-21T00:00:00.000Z",
      knowledgeAt: "2026-08-21T00:00:00.000Z",
      periodicity: "quarterly",
      filingBasis: "consolidated",
      startPeriod: "2026-Q2",
      endPeriod: "2026-Q2",
    });
    const amendment = records.find((record) => record.publicationContext.revisionSequence === 1);
    const original = records.find((record) => record.publicationContext.revisionSequence === 0);
    expect(amendment?.publicationContext).toMatchObject({ amendment: true, revisionSequence: 1 });
    expect(amendment?.relations).toEqual([{ kind: "supersedes", targetRecordKey: researchFinancialStatementRecordKey(original!) }]);
  });

  it("official MOPS acquisition: discrete quarter contexts stay discrete and emitted supersedes keys resolve to stored predecessors", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const q2Revision1Url = `${OFFICIAL_FINANCIAL_STATEMENT_BASE_URL}?co_id=2330&year=2026&season=2&rev=1`;
    const q2Revision2Url = `${OFFICIAL_FINANCIAL_STATEMENT_BASE_URL}?co_id=2330&year=2026&season=2&rev=2`;
    const q3Revision1Url = `${OFFICIAL_FINANCIAL_STATEMENT_BASE_URL}?co_id=2330&year=2026&season=3&rev=1`;
    const payloads = new Map<string, string>([
      [q2Revision1Url, `<?xml version="1.0" encoding="utf-8"?>
        <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full">
          <xbrli:context id="q2"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
          <xbrli:context id="q2i"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
          <xbrli:unit id="twd"><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit>
          <ifrs-full:RevenueFromContractsWithCustomers contextRef="q2" unitRef="twd">30</ifrs-full:RevenueFromContractsWithCustomers>
          <ifrs-full:CashFlowsFromUsedInOperatingActivities contextRef="q2" unitRef="twd">10</ifrs-full:CashFlowsFromUsedInOperatingActivities>
          <ifrs-full:Assets contextRef="q2i" unitRef="twd">50</ifrs-full:Assets>
        </xbrli:xbrl>`],
      [q2Revision2Url, `<?xml version="1.0" encoding="utf-8"?>
        <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full">
          <xbrli:context id="q2"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
          <xbrli:context id="q2i"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
          <xbrli:unit id="twd"><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit>
          <ifrs-full:RevenueFromContractsWithCustomers contextRef="q2" unitRef="twd" scale="3">32</ifrs-full:RevenueFromContractsWithCustomers>
          <ifrs-full:CashFlowsFromUsedInOperatingActivities contextRef="q2" unitRef="twd">11</ifrs-full:CashFlowsFromUsedInOperatingActivities>
          <ifrs-full:Assets contextRef="q2i" unitRef="twd">52</ifrs-full:Assets>
        </xbrli:xbrl>`],
      [q3Revision1Url, `<?xml version="1.0" encoding="utf-8"?>
        <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full">
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

    expect(descriptors).toHaveLength(11);
    expect(descriptors).toContainEqual(
      expect.objectContaining({
        listingId: identity.listing.id,
        issuerId: identity.issuer.id,
        ticker: "2330",
        venue: "TWSE",
        sector: "operating_company",
        sourceUrl: expect.stringMatching(/step=1&CO_ID=2330&SYEAR=2026&SSEASON=2&REPORT_ID=C/),
        filing: expect.objectContaining({
          fiscalYear: 2026,
          fiscalPeriod: "q2",
          periodStart: "2026-04-01",
          periodEnd: "2026-06-30",
          filingBasis: "unknown",
          publishedAt: "2026-09-01",
        }),
      }),
    );
    expect(descriptors.filter((descriptor) => descriptor.filing.fiscalPeriod === "annual")
      .map((descriptor) => descriptor.filing.fiscalYear)).toEqual([2023, 2024, 2025]);
    expect(descriptors.filter((descriptor) => descriptor.filing.fiscalPeriod !== "annual")).toHaveLength(8);

    const postAnnualDue = buildCurrentMopsFinancialStatementDescriptors(
      [identity],
      new Date("2026-04-15T00:00:00.000Z"),
    );
    expect(postAnnualDue.filter((descriptor) => descriptor.filing.fiscalPeriod !== "annual")).toContainEqual(
      expect.objectContaining({ filing: expect.objectContaining({ fiscalYear: 2025, fiscalPeriod: "q4", periodEnd: "2025-12-31" }) }),
    );
  });
});
