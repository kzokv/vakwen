# Taiwan Research Identity

KZO-246 delivers an identity-only research vertical. It is separate from the legacy instrument catalog and portfolio market-data paths.

## Data flow

1. A positive-gated pg-boss worker fetches declared official TWSE and TPEx snapshots, including the TWSE securities-firm master and explicit company/ETN retirement tables. A retirement that predates the first acquisition seeds a source-backed inactive historical identity, so fresh databases retain and resolve the official event instead of discarding it for lack of a current-feed predecessor; multiple distinct retirements of a reused ticker seed distinct historical lifecycles and only an exact recorded event is deduplicated. Historical retirement IDs use stable venue, security type, ticker, and retirement date fields; mutable company, issuer, and display names remain revision observations, so official label corrections retain the same Listing. Because retirement-only rows do not publish an original listing date, their conservative identity boundary starts on the retirement date instead of inventing an earlier date. ETF absence retirement is fail-closed: provider success and non-empty payloads are required, and a venue snapshot that omits more than the 1% completeness guard is rejected before any records append. A first sub-threshold omission records non-terminal absence evidence; only a later acquisition that still omits the Listing without an intervening active snapshot writes the terminal inactive revision.
2. Provider adapters validate source-native fields, preserve ticker strings, normalize dates and numeric values, and retain raw values alongside normalized values. Taiwan date-only facts become effective at Taiwan midnight (`16:00Z` on the preceding UTC date), not midnight UTC.
3. Canonicalization assigns opaque stable `Issuer`, `Security`, and effective-dated `Listing` IDs. Company IDs use the official unified business number. ETF issuer and product identities are separate: TWSE funds use the published fund business number, while TPEx funds use the venue-scoped official `issuerID` for Issuer identity and the exchange product code for product identity; mutable fund names are evidence, not ID inputs. ETN issuer IDs use the securities-firm master's business number, while ETN contract identities use the exchange product code plus stable venue, issuer, listing-date, maturity-date, and note-type facts; mutable index, legal, and display labels are not ID inputs. When an official product-code correction retains the same issuer, listing date, and product name, acquisition reuses the existing product identity so a code correction does not create a false retirement/relisting. Ambiguous reconciliation fails closed. An unresolved ETN issuer fails acquisition instead of producing an unstable fallback ID.
4. Memory and PostgreSQL append immutable revisions. Reads apply both `effectiveAt` and `knowledgeAt` cutoffs. Latest-state resolution overlays the latest effective and known inactive status-only revision onto the latest full identity basis for the same immutable Listing. This keeps retirement terminal for status and eligibility without hiding later authoritative ticker, name, or classification corrections. A blocked current row still contributes its non-status identity observations through an inactive identity basis, while the retirement source remains the sole status authority. Scheduled acquisition reads one bounded identity revision plus one bounded status revision per Listing and venue rather than materializing each Listing's complete immutable history.
5. Store-only services resolve exactly one listing and return a fixed temporal context. They never fetch upstream data. Effective and as-recorded assessments return persisted eligibility; re-evaluation requests fail explicitly until versioned policy-set evaluation is implemented. Request-time latest-state reads return at most the latest identity, terminal-status, and non-terminal absence-evidence revisions per candidate Listing, while chronological history uses indexed keyset pages capped at `limit + 1`. Emitted keyset cursors remain within a bounded 512-character request envelope. Identity provenance is bounded to sources supporting the current facts and requested history page.
6. MCP exposes concrete object schemas for `get_research_manifest` and `get_research_identity` under `research:read`. Each structured response has one required `result` field whose value is a strict success-or-error union; empty, truncated, and mixed success/error payloads are rejected.
7. The `taiwan-stock-research` Skill freezes the returned listing/context and produces a canonical `research-report/1.0.0` identity-only artifact before rendering Markdown.

## Canonical persistence

Migration `116_research_identity_history.sql` creates `research.identity_records`; migration `117_research_identity_revision_precedence.sql` adds the stored semantic tie-breaker; migration `118_research_identity_latest_listing_index.sql` adds the venue/listing temporal index used by bounded acquisition reads; migration `119_research_identity_history_page_index.sql` adds listing-scoped latest-revision and chronological keyset indexes for request reads. Each row stores selector and temporal columns for indexed queries plus the complete canonical JSON record. `record_key` is derived from provenance and listing IDs; retries of the same acquisition record are idempotent and never overwrite earlier history, while a later retrieval remains a distinct knowledge-time observation.

Identity revisions carry:

- raw and normalized source facts with explicit missingness
- effective, retrieval, and processing timestamps
- publisher, exact access provider (`TWSE_OPENAPI`, `TPEX_OPENAPI`, `TWSE_WEB_JSON`, or `TPEX_WEB_JSON`), authority role, source URL, content hash, acquisition run, parser version, usage policy, retention, and exposure metadata
- operating-company, ETF-limited, identity-only, or unknown eligibility
- active/inactive listing status and predecessor listing linkage for venue transfers

## Query invariants

- A selector is exactly `listing_id` or `ticker_venue`.
- Tickers remain strings; leading zeroes and alphanumeric suffixes are significant.
- `effectiveAt` must not exceed `knowledgeAt`.
- Ticker/venue resolution compares the selector with each candidate Listing's effective latest ticker state. An obsolete ticker fails with `research_subject_not_found`; if it has been reassigned, only the new Listing remains a candidate.
- A ticker/venue resolving to more than one effective latest listing fails with `research_subject_ambiguous`.
- When a ticker has been reused, a known inactive predecessor does not make the sole active Listing ambiguous. If knowledge-time evidence still leaves multiple Listings active, resolution fails closed.
- Reads return only records whose effective and retrieval timestamps are within the fixed context, preventing future-information leakage.
- History cursors are opaque keyset positions bound to the immutable Listing plus the complete fixed temporal context; cross-subject or cross-context reuse fails with `research_cursor_invalid`.
- Manifest output is unpaginated status metadata for exactly eleven canonical dataset IDs. In this release only `research_identity` is available.
