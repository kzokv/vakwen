# Research Financial Statements

KZO-249 adds a financial-statement acquisition and reporting lane to the Taiwan research vertical. This lane is separate from legacy market-data readers and remains store-first at read time.

## Boundaries

- Authority: official MOPS XBRL and iXBRL instances only.
- Access provider: `MOPS_XBRL`.
- Acquisition side: fetches explicit descriptor URLs, hashes the full artifact, parses contexts, units, concepts, and facts, and preserves filing metadata including revision and amendment or restatement state.
- Worker side: the research-enabled pg-boss startup registers the daily financial-statement worker. At run time it builds an 11-period historical window for every active Golden Path operating-company identity—three latest legally due annual filings plus eight latest legally due quarterly filings—and acquires the official MOPS descriptors with bounded concurrency and per-filing failure isolation. Empty or incomplete statement artifacts are rejected, successful filings are persisted even when siblings fail, changed content is promoted to an amendment revision with predecessor lineage, and an empty identity store is an explicit no-op until identity acquisition has populated canonical listings.
- Read side: research tools and skills must read only from the canonical store through `get_financial_statements`; they must not call MOPS, FinMind, or convenience-summary pages directly.

## Taxonomy And Ambiguity

- MOPS has required XBRL filings since 2010 and iXBRL since 2019 Q1.
- Canonical storage must preserve versioned taxonomy lineage from the artifact namespace map and fact namespaces.
- Source facts expose both raw and normalized values plus scale, precision, format, and sign metadata so transformations remain auditable.
- Duplicate contexts are retained rather than collapsed.
- Byte-equivalent repeated facts are deduplicated during materialization; conflicting facts that share an identity remain validation errors.
- Unknown units and unmapped concepts remain explicit quality issues.
- Basis ambiguity, taxonomy ambiguity, and context ambiguity are withholding conditions for fundamentals conclusions.
- Amendment records preserve the original filing publication timestamp and record the amendment observation separately as the revision publication timestamp.

## Reporting Policy

- The fundamentals report is descriptive only.
- Latest due YoY conclusions require the latest due filing plus the prior-year comparable period.
- Multi-year trend conclusions require 3 complete annual periods with usable current-period facts for every core statement.
- Quarterly trend or seasonality conclusions require 8 comparable discrete quarters.
- Unsupported sectors, including financial institutions in the initial policy set, must produce withheld conclusions rather than partial interpretation.
- Rendering is a faithful projection of the canonical artifact; it must not add forecasts, valuation, or recommendations.
