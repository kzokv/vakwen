import { describe, expect, it } from "vitest";
import {
  parseMopsFinancialStatementArtifact,
  type MopsFinancialStatementDescriptor,
} from "../../src/services/research/providers/mopsXbrl.js";
import { materializeResearchFinancialStatementRecord } from "../../src/services/research/financialStatements.js";

const xbrlDescriptor: MopsFinancialStatementDescriptor = {
  listingId: "lst_2330_twse",
  issuerId: "iss_22099131",
  ticker: "2330",
  expectedEntityIdentifiers: ["22099131"],
  venue: "TWSE",
  sector: "operating_company",
  sourceUrl: "https://mops.twse.com.tw/server-java/t164sb01?co_id=2330&year=2026&season=2",
  filing: {
    filingId: "mops:2330:2026:q2:r2",
    fiscalYear: 2026,
    fiscalPeriod: "q2",
    periodStart: "2026-01-01",
    periodEnd: "2026-06-30",
    filingBasis: "consolidated",
    publishedAt: "2026-08-14",
    revision: 2,
    amendmentType: "restatement",
  },
};

describe("MOPS XBRL provider parser", () => {
  it("xbrl parser: preserve authoritative artifact metadata and explicit ambiguity flags → no convenience-summary synthesis", () => {
    const artifact = parseMopsFinancialStatementArtifact(
      `<?xml version="1.0" encoding="utf-8"?>
      <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
        xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
        xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
        xmlns:currency="http://www.xbrl.org/2003/iso4217"
        xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full"
        xmlns:tifrs-bsci-ci="https://mops.twse.com.tw/taxonomy/2026/tifrs-bsci-ci"
        xmlns:custom="https://mops.twse.com.tw/taxonomy/2026/custom">
        <xbrli:context id="ctx_consolidated">
          <xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity>
          <xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period>
          <xbrli:scenario>
            <xbrldi:explicitMember dimension="tifrs-bsci-ci:StatementBasisAxis">tifrs-bsci-ci:ConsolidatedEntitiesMember</xbrldi:explicitMember>
          </xbrli:scenario>
        </xbrli:context>
        <xbrli:context id="ctx_consolidated_dup">
          <xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity>
          <xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period>
          <xbrli:scenario>
            <xbrldi:explicitMember dimension="tifrs-bsci-ci:StatementBasisAxis">tifrs-bsci-ci:ConsolidatedEntitiesMember</xbrldi:explicitMember>
          </xbrli:scenario>
        </xbrli:context>
        <xbrli:context id="ctx_individual">
          <xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity>
          <xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period>
          <xbrli:scenario>
            <xbrldi:explicitMember dimension="tifrs-bsci-ci:StatementBasisAxis">tifrs-bsci-ci:SeparateFinancialStatementsMember</xbrldi:explicitMember>
          </xbrli:scenario>
        </xbrli:context>
        <xbrli:context id="ctx_typed_segment">
          <xbrli:entity>
            <xbrli:identifier scheme="TWSE">22099131</xbrli:identifier>
            <xbrli:segment>
              <xbrldi:typedMember dimension="custom:OperatingSegmentAxis"><custom:SegmentName>Foundry</custom:SegmentName></xbrldi:typedMember>
            </xbrli:segment>
          </xbrli:entity>
          <xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period>
        </xbrli:context>
        <xbrli:context id="ctx_instant">
          <xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity>
          <xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period>
        </xbrli:context>
        <xbrli:context id="ctx_comparative">
          <xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity>
          <xbrli:period><xbrli:instant>2025-12-31</xbrli:instant></xbrli:period>
        </xbrli:context>
        <xbrli:unit id="twd"><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit>
        <xbrli:unit id="twd_alias"><xbrli:measure>currency:TWD</xbrli:measure></xbrli:unit>
        <xbrli:unit id="twd_scoped" xmlns:scoped-currency="http://www.xbrl.org/2003/iso4217">
          <xbrli:measure>scoped-currency:TWD</xbrli:measure>
        </xbrli:unit>
        <xbrli:unit id="twd_direct">
          <xbrli:measure xmlns:direct-currency="http://www.xbrl.org/2003/iso4217">direct-currency:TWD</xbrli:measure>
        </xbrli:unit>
        <ifrs-full:Inventories contextRef="ctx_comparative" unitRef="twd">190000</ifrs-full:Inventories>
        <ifrs-full:Assets contextRef="ctx_consolidated" unitRef="twd">3450000</ifrs-full:Assets>
        <ifrs-full:Inventories contextRef="ctx_instant" unitRef="twd">210000</ifrs-full:Inventories>
        <ifrs-full:BasicEarningsLossPerShare contextRef="ctx_consolidated" unitRef="twd">12.5</ifrs-full:BasicEarningsLossPerShare>
        <ifrs-full:RevenueFromContractsWithCustomers contextRef="ctx_consolidated" unitRef="twd">1234000</ifrs-full:RevenueFromContractsWithCustomers>
        <ifrs-full:RevenueFromContractsWithCustomers contextRef="ctx_individual" unitRef="twd">1111000</ifrs-full:RevenueFromContractsWithCustomers>
        <ifrs-full:RevenueFromContractsWithCustomers contextRef="ctx_typed_segment" unitRef="twd">222000</ifrs-full:RevenueFromContractsWithCustomers>
        <ifrs-full:GrossProfit contextRef="ctx_consolidated" unitRef="twd" xsi:nil="true" />
        <ifrs-full:CashFlowsFromUsedInOperatingActivities contextRef="ctx_consolidated" unitRef="unknown_unit">88000</ifrs-full:CashFlowsFromUsedInOperatingActivities>
        <custom:scope xmlns:scoped-ifrs="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full">
          <scoped-ifrs:Equity contextRef="ctx_instant" unitRef="twd">2800000</scoped-ifrs:Equity>
        </custom:scope>
        <custom:UnmappedMetric contextRef="ctx_consolidated" unitRef="twd">42</custom:UnmappedMetric>
      </xbrli:xbrl>`,
      xbrlDescriptor,
      {
        retrievedAt: "2026-08-15T00:00:00.000Z",
        acquisitionRunId: "financial-statements-test",
      },
    );

    expect(artifact.artifact.publisher).toBe("MOPS");
    expect(artifact.artifact.accessProvider).toBe("MOPS_XBRL");
    expect(artifact.filing.amendmentType).toBe("restatement");
    expect(artifact.issues.duplicateContextGroups).toHaveLength(1);
    expect(artifact.issues.unknownUnitIds).toEqual(["unknown_unit"]);
    expect(artifact.issues.unmappedConcepts).toEqual(["custom:UnmappedMetric"]);
    expect(artifact.issues.basisAmbiguity).toBe(true);
    expect(artifact.issues.contextAmbiguity).toBe(true);
    expect(artifact.issues.taxonomyAmbiguity).toBe(false);
    expect(artifact.artifact.taxonomyVersions).toContain("2026-03-01");
    expect(artifact.facts.map((fact) => fact.concept.localName)).toContain("RevenueFromContractsWithCustomers");
    expect(artifact.facts.find((fact) => fact.concept.localName === "GrossProfit")?.normalizedValue).toBe("");
    expect(artifact.contexts).toHaveLength(6);
    expect(artifact.facts.find((fact) => fact.concept.localName === "Inventories")?.statementRole)
      .toBe("balance_sheet");
    expect(artifact.facts.find((fact) => fact.concept.localName === "BasicEarningsLossPerShare")?.statementRole)
      .toBe("income_statement");
    expect(artifact.facts.find((fact) => fact.concept.qname === "scoped-ifrs:Equity")?.concept.namespaceUri)
      .toBe("http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full");
    expect(artifact.contexts.find((context) => context.id === "ctx_typed_segment")?.dimensions).toEqual([
      { dimension: "custom:OperatingSegmentAxis", member: "custom:SegmentName:Foundry" },
    ]);
    expect(artifact.facts.find((fact) => fact.contextRef === "ctx_typed_segment")?.contextDimensions).toEqual([
      { dimension: "custom:OperatingSegmentAxis", member: "custom:SegmentName:Foundry" },
    ]);
    expect(artifact.units).toHaveLength(4);
    expect(artifact.units.map((unit) => unit.measures)).toEqual([
      ["{http://www.xbrl.org/2003/iso4217}TWD"],
      ["{http://www.xbrl.org/2003/iso4217}TWD"],
      ["{http://www.xbrl.org/2003/iso4217}TWD"],
      ["{http://www.xbrl.org/2003/iso4217}TWD"],
    ]);
    const record = materializeResearchFinancialStatementRecord(artifact);
    expect(record.issuerId).toBe(xbrlDescriptor.issuerId);
    expect(record.fiscalPeriod).toMatchObject({
      periodStart: xbrlDescriptor.filing.periodStart,
      periodEnd: xbrlDescriptor.filing.periodEnd,
    });
    expect(record.statements.find((statement) => statement.kind === "balance_sheet")?.facts)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          issuerId: xbrlDescriptor.issuerId,
          concept: expect.objectContaining({ qname: "ifrs-full:Inventories" }),
        }),
      ]));
    expect(record.statements.find((statement) => statement.kind === "income")?.facts)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ concept: expect.objectContaining({ qname: "ifrs-full:BasicEarningsLossPerShare" }) }),
      ]));
  });

  it("ixbrl parser: preserve inline facts, scale, and taxonomy lineage → no quarter synthesis during parsing", () => {
    const artifact = parseMopsFinancialStatementArtifact(
      `<!DOCTYPE html>
      <html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"
        xmlns:xbrli="http://www.xbrl.org/2003/instance"
        xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
        xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"
        xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full"
        xmlns:custom="https://mops.twse.com.tw/taxonomy/2026/custom"
        xmlns:tifrs-bsci-ci="https://mops.twse.com.tw/taxonomy/2026/tifrs-bsci-ci">
        <body>
          <xbrli:context id="ctx_q2">
            <xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity>
            <xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period>
          </xbrli:context>
          <xbrli:unit id="twd"><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit>
          <ix:nonFraction name="ifrs-full:RevenueFromContractsWithCustomers" contextRef="ctx_q2" unitRef="twd" scale="3" decimals="-3">1,234</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:GrossProfit" contextRef="ctx_q2" unitRef="twd" precision="5">400</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:BasicEarningsLossPerShare" contextRef="ctx_q2" unitRef="twd" format="ixt:num-comma-decimal">1.234,5</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:FinanceCosts" contextRef="ctx_q2" unitRef="twd" format="ixt:zero-dash">&#45;</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:IncomeTaxExpenseContinuingOperations" contextRef="ctx_q2" unitRef="twd" format="ixt:zero-dash">&#x2212;</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:Liabilities" contextRef="ctx_q2" unitRef="twd" xsi:nil="true" />
          <ix:nonFraction name="ifrs-full:OperatingIncomeLoss" contextRef="ctx_q2" unitRef="twd">300</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:ProfitLoss" contextRef="ctx_q2" unitRef="twd">88</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:CashFlowsFromUsedInOperatingActivities" contextRef="ctx_q2" unitRef="twd">66</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:PurchaseOfPropertyPlantAndEquipment" contextRef="ctx_q2" unitRef="twd" sign="-">25</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:DividendsPaidClassifiedAsFinancingActivities" contextRef="ctx_q2" unitRef="twd">10</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:AdjustmentsForReconcileProfitLoss" contextRef="ctx_q2" unitRef="twd">15</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:IncreaseDecreaseInEquity" contextRef="ctx_q2" unitRef="twd">20</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:GainsLossesOnCashFlowHedgesNetOfTax" contextRef="ctx_q2" unitRef="twd">5</ix:nonFraction>
          <ix:nonNumeric name="custom:NarrativeDisclosure" contextRef="ctx_q2" continuedAt="continuation-1">Alpha <ix:exclude>remove me</ix:exclude></ix:nonNumeric>
          <ix:continuation id="continuation-1" continuedAt="continuation-2">Beta</ix:continuation>
          <ix:continuation id="continuation-2">Gamma</ix:continuation>
          <ix:nonFraction name="ifrs-full:Assets" contextRef="ctx_q2" unitRef="twd">999</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:CurrentAssets" contextRef="ctx_q2" unitRef="twd">700</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:CurrentLiabilities" contextRef="ctx_q2" unitRef="twd">350</ix:nonFraction>
          <ix:nonFraction name="ifrs-full:InterestBearingBorrowings" contextRef="ctx_q2" unitRef="twd">120</ix:nonFraction>
          <ix:nonFraction name="tifrs-bsci-ci:EquityAtBeginningOfPeriod" contextRef="ctx_q2" unitRef="twd">800</ix:nonFraction>
          <section xmlns:scoped-ifrs="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full">
            <ix:nonFraction name="scoped-ifrs:Equity" contextRef="ctx_q2" unitRef="twd">900</ix:nonFraction>
          </section>
          <ix:nonFraction xmlns:direct-ifrs="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full"
            name="direct-ifrs:CashAndCashEquivalents" contextRef="ctx_q2" unitRef="twd">250</ix:nonFraction>
        </body>
      </html>`,
      {
        ...xbrlDescriptor,
        sourceUrl: "https://mops.twse.com.tw/server-java/t164sb01?co_id=2330&year=2026&season=2&step=ix",
      },
      {
        retrievedAt: "2026-08-15T00:00:00.000Z",
        acquisitionRunId: "financial-statements-test",
      },
    );

    expect(artifact.artifact.artifactKind).toBe("ixbrl");
    expect(artifact.facts.find((fact) => fact.concept.localName === "RevenueFromContractsWithCustomers")?.normalizedValue)
      .toBe("1234000");
    expect(artifact.facts.find((fact) => fact.concept.localName === "RevenueFromContractsWithCustomers")).toMatchObject({
      decimals: "-3",
      precision: null,
    });
    expect(artifact.facts.find((fact) => fact.concept.localName === "GrossProfit")).toMatchObject({
      decimals: null,
      precision: "5",
    });
    expect(artifact.facts.find((fact) => fact.concept.localName === "PurchaseOfPropertyPlantAndEquipment")?.normalizedValue)
      .toBe("-25");
    expect(artifact.facts.find((fact) => fact.concept.localName === "BasicEarningsLossPerShare")?.normalizedValue)
      .toBe("1234.5");
    expect(artifact.facts.find((fact) => fact.concept.localName === "FinanceCosts")?.normalizedValue)
      .toBe("0");
    expect(artifact.facts.find((fact) => fact.concept.localName === "FinanceCosts")?.rawValue)
      .toBe("-");
    expect(artifact.facts.find((fact) => fact.concept.localName === "IncomeTaxExpenseContinuingOperations")).toMatchObject({
      rawValue: "−",
      normalizedValue: "0",
    });
    expect(artifact.facts.find((fact) => fact.concept.localName === "Liabilities")?.normalizedValue).toBe("");
    expect(artifact.facts.filter((fact) => ["GrossProfit", "OperatingIncomeLoss"].includes(fact.concept.localName))
      .every((fact) => fact.statementRole === "income_statement")).toBe(true);
    expect(artifact.facts.filter((fact) => ["CurrentAssets", "CurrentLiabilities", "InterestBearingBorrowings"].includes(fact.concept.localName))
      .every((fact) => fact.statementRole === "balance_sheet")).toBe(true);
    expect(artifact.facts.find((fact) => fact.concept.localName === "PurchaseOfPropertyPlantAndEquipment")?.statementRole)
      .toBe("cash_flow_statement");
    expect(artifact.facts.find((fact) => fact.concept.localName === "DividendsPaidClassifiedAsFinancingActivities")?.statementRole)
      .toBe("cash_flow_statement");
    expect(artifact.facts.find((fact) => fact.concept.localName === "AdjustmentsForReconcileProfitLoss")?.statementRole)
      .toBe("cash_flow_statement");
    expect(artifact.facts.find((fact) => fact.concept.localName === "NarrativeDisclosure")).toMatchObject({
      inlineType: "nonNumeric",
      statementRole: "notes",
      rawValue: "Alpha Beta Gamma",
      normalizedValue: "Alpha Beta Gamma",
      unitRef: null,
    });
    expect(artifact.issues.unmappedConcepts).not.toContain("custom:NarrativeDisclosure");
    expect(artifact.facts.find((fact) => fact.concept.localName === "EquityAtBeginningOfPeriod")?.statementRole)
      .toBe("equity_statement");
    expect(artifact.facts.find((fact) => fact.concept.localName === "IncreaseDecreaseInEquity")?.statementRole)
      .toBe("equity_statement");
    expect(artifact.facts.find((fact) => fact.concept.localName === "GainsLossesOnCashFlowHedgesNetOfTax")?.statementRole)
      .toBe("income_statement");
    expect(artifact.facts.find((fact) => fact.concept.qname === "scoped-ifrs:Equity")?.concept.namespaceUri)
      .toBe("http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full");
    expect(artifact.facts.find((fact) => fact.concept.qname === "direct-ifrs:CashAndCashEquivalents")?.concept.namespaceUri)
      .toBe("http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full");
    expect(artifact.issues.missingStatementRoles).toEqual([]);
    expect(artifact.issues.taxonomyAmbiguity).toBe(false);
  });

  it("numeric facts without unitRef raise artifact-wide unknown-unit state", () => {
    const retrievedAt = "2026-08-15T00:00:00.000Z";
    const artifact = parseMopsFinancialStatementArtifact(
      `<?xml version="1.0" encoding="utf-8"?>
      <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full">
        <xbrli:context id="duration"><xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
        <ifrs-full:Revenue contextRef="duration">60</ifrs-full:Revenue>
      </xbrli:xbrl>`,
      xbrlDescriptor,
      { retrievedAt, acquisitionRunId: "missing-unit-test" },
    );

    expect(artifact.issues.unknownUnitIds).toEqual(["<missing>"]);
    expect(materializeResearchFinancialStatementRecord(artifact, { processedAt: retrievedAt }).ambiguityFlags)
      .toContain("unknown_unit");
  });

  it("rejects facts whose context reference cannot be resolved", () => {
    expect(() => parseMopsFinancialStatementArtifact(
      `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
        xmlns:ifrs-full="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full">
        <ifrs-full:Revenue contextRef="missing-context">10</ifrs-full:Revenue>
      </xbrli:xbrl>`,
      xbrlDescriptor,
      {
        retrievedAt: "2026-08-15T00:00:00.000Z",
        acquisitionRunId: "financial-statements-test",
      },
    )).toThrow("references unknown context missing-context");
  });

  it("accepts single-quoted XML attributes", () => {
    const artifact = parseMopsFinancialStatementArtifact(
      `<xbrli:xbrl xmlns:xbrli='http://www.xbrl.org/2003/instance'
        xmlns:ifrs-full='http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full'>
        <xbrli:context id='single-context'>
          <xbrli:entity><xbrli:identifier scheme='TWSE'>22099131</xbrli:identifier></xbrli:entity>
          <xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period>
        </xbrli:context>
        <xbrli:unit id='twd'><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit>
        <ifrs-full:Revenue contextRef='single-context' unitRef='twd'>10</ifrs-full:Revenue>
      </xbrli:xbrl>`,
      xbrlDescriptor,
      {
        retrievedAt: "2026-08-15T00:00:00.000Z",
        acquisitionRunId: "financial-statements-test",
      },
    );

    expect(artifact.contexts[0]?.id).toBe("single-context");
    expect(artifact.facts).toEqual([
      expect.objectContaining({ contextRef: "single-context", rawValue: "10" }),
    ]);
  });

  it("parses unprefixed facts from the default taxonomy namespace", () => {
    const artifact = parseMopsFinancialStatementArtifact(
      `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
        xmlns="http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full">
        <xbrli:context id="duration">
          <xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity>
          <xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period>
        </xbrli:context>
        <xbrli:context id="instant">
          <xbrli:entity><xbrli:identifier scheme="TWSE">22099131</xbrli:identifier></xbrli:entity>
          <xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period>
        </xbrli:context>
        <Revenue contextRef="duration">10</Revenue>
        <CashFlowsFromUsedInOperatingActivities contextRef="duration">5</CashFlowsFromUsedInOperatingActivities>
        <Assets contextRef="instant">20</Assets>
      </xbrli:xbrl>`,
      xbrlDescriptor,
      {
        retrievedAt: "2026-08-15T00:00:00.000Z",
        acquisitionRunId: "financial-statements-test",
      },
    );

    expect(artifact.facts.map((fact) => [fact.concept.qname, fact.statementRole])).toEqual([
      ["Revenue", "income_statement"],
      ["CashFlowsFromUsedInOperatingActivities", "cash_flow_statement"],
      ["Assets", "balance_sheet"],
    ]);
    expect(artifact.facts.every((fact) => fact.concept.namespaceUri === "http://xbrl.ifrs.org/taxonomy/2026-03-01/ifrs-full"))
      .toBe(true);
  });
});
