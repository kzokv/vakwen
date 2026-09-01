import { describe, expect, it, vi } from "vitest";
import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { researchFinancialStatementRecordKey } from "../../src/services/research/financialStatements.js";
import {
  runOfficialFinancialStatementAcquisition,
  OFFICIAL_FINANCIAL_STATEMENT_BASE_URL,
} from "../../src/services/research/acquisition.js";
import {
  createResearchFinancialStatementAcquisitionHandler,
  registerResearchFinancialStatementAcquisitionWorker,
  RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_CRON,
  RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_QUEUE,
} from "../../src/services/research/registerFinancialStatementAcquisitionWorker.js";

describe("research financial statement acquisition", () => {
  it("official MOPS acquisition: duration facts remain cumulative and emitted supersedes keys resolve to stored predecessors", async () => {
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
          <ifrs-full:RevenueFromContractsWithCustomers contextRef="q2" unitRef="twd">32</ifrs-full:RevenueFromContractsWithCustomers>
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
      .every((fact) => fact.context.valueKind === "cumulative")).toBe(true);
    expect(q3Latest?.statements.flatMap((section) => section.facts)
      .filter((fact) => fact.context.period.kind === "duration")
      .every((fact) => fact.context.valueKind === "cumulative")).toBe(true);

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
      expect.objectContaining({ policy: "singleton" }),
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
    await expect(handler([{ id: "job-1" } as never])).rejects.toThrow("requires at least one descriptor");
    expect(resolveDescriptors).toHaveBeenCalled();
  });
});
