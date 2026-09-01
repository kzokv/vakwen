# Research Financial Statements

KZO-249 adds a financial-statement acquisition and reporting lane to the Taiwan research vertical. This lane is separate from legacy market-data readers and remains store-first at read time.

## Boundaries

- Authority: official MOPS XBRL and iXBRL instances only.
- Access provider: `MOPS_XBRL`.
- Acquisition side: fetches explicit descriptor URLs, hashes the full artifact, parses contexts, units, concepts, and facts, and preserves filing metadata including revision and amendment or restatement state.
- Worker side: the research-enabled pg-boss startup registers the daily financial-statement worker. At run time it selects the latest legally due filing period for active Golden Path operating-company identities, builds bounded official MOPS descriptors, and feeds only those artifacts into the acquisition entrypoint. An empty identity store is an explicit no-op until identity acquisition has populated canonical listings.
- Read side: research tools and skills must read only from the canonical store through `get_financial_statements`; they must not call MOPS, FinMind, or convenience-summary pages directly.

## Taxonomy And Ambiguity

- MOPS has required XBRL filings since 2010 and iXBRL since 2019 Q1.
- Canonical storage must preserve versioned taxonomy lineage from the artifact namespace map and fact namespaces.
- Duplicate contexts are retained rather than collapsed.
- Unknown units and unmapped concepts remain explicit quality issues.
- Basis ambiguity, taxonomy ambiguity, and context ambiguity are withholding conditions for fundamentals conclusions.

## Reporting Policy

- The fundamentals report is descriptive only.
- Latest due YoY conclusions require the latest due filing plus the prior-year comparable period.
- Multi-year trend conclusions require 3 complete annual periods.
- Quarterly trend or seasonality conclusions require 8 comparable discrete quarters.
- Unsupported sectors, including financial institutions in the initial policy set, must produce withheld conclusions rather than partial interpretation.
- Rendering is a faithful projection of the canonical artifact; it must not add forecasts, valuation, or recommendations.
