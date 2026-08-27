# KZO-244 — Taiwan Stock Research V1 Acceptance Evidence

Last updated: 2026-08-27 (Asia/Taipei)

Matrix version: `1.0.0`

Linear: [KZO-244](https://linear.app/kzokv/issue/KZO-244/define-v1-acceptance-evidence-and-reference-company-matrix)

## Decision

Taiwan Stock Research V1 uses three independently satisfied acceptance gates, requirement-level traceability, a hybrid real-subject and deterministic-fixture matrix, and immutable evidence manifests. Acceptance is binary at each gate. A correct data-quality degradation is a valid product result; it is not confused with implementation failure or rollout readiness.

The canonical machine-readable artifact is [kzo-244-acceptance-matrix.json](./kzo-244-acceptance-matrix.json), validated by [kzo-244-acceptance-matrix.schema.json](./kzo-244-acceptance-matrix.schema.json). This document explains the policy and rationale. If prose and matrix conflict, the conflict blocks Gate 1 until both are reconciled under a new matrix version.

The technical term is **reference subject**, not reference company. The matrix includes operating companies, ETFs, ETNs, historical Listings, source artifacts, and synthetic portfolio contexts.

## Authoritative specification corpus

Traceability is closed over:

1. KZO-234 standing decisions and scope;
2. the final resolutions of KZO-235 through KZO-243;
3. the KZO-235 artifact at commit `6d13607c`;
4. the KZO-236 artifact at commit `43a81f7e`;
5. this KZO-244 resolution and its committed artifacts.

Earlier drafts, discussion, and superseded comments are context only unless a final resolution incorporates them. Every normative requirement and prohibition must map to at least one immutable acceptance ID. Retired IDs are never reused.

## Acceptance gates

| Gate | Boundary | Required outcome |
|---|---|---|
| G1 — Specification handoff | Before implementation planning | The specification is complete, internally consistent, source-faithful, and implementable. No decision-level TBD or contradiction remains. |
| G2 — Implementation conformance | Before user exposure | Schemas, tools, data behavior, reports, valuation, privacy, compatibility, and safety conform on the assigned backends. |
| G3 — Rollout readiness | Before each rollout promotion | Live source health, phase observations, coexistence, operator controls, and rollback satisfy KZO-243. |

G1, G2, and G3 are not interchangeable. A complete specification is not implemented software. Passing deterministic conformance during a provider outage does not establish rollout readiness. Deployment health does not authorize feature exposure.

KZO-243 remains authoritative for numeric observation windows, run counts, reliability, latency, evaluation-failure, and rollback thresholds. This specification assigns acceptance IDs and evidence formats; it does not copy those thresholds into a second policy source.

## Pass standard and deferrals

G1 permits no unresolved item that can affect observable behavior, public contracts, source authority, calculations, recommendation semantics, security, privacy, compatibility, or rollout safety. An implementation mechanic may be deferred only when its record names:

- the precise boundary;
- why the decision is not behaviorally material;
- an owner;
- the implementation-planning destination.

Every applicable non-waived case must pass. Percentage coverage, prose assurances, and “covered elsewhere” without a stable traceability entry do not pass.

## Reference-subject selection policy

Selection is coverage-driven, not quota-driven. Each subject must contribute a unique contract, board, profile, valuation, or lifecycle path. Primary references run their complete role-specific cases. Fallbacks receive identity, eligibility, route, and required-source smoke checks at every rollout phase; a full fallback run is required only when it is promoted or deliberately sampled.

Real subjects prove authentic routing and source behavior. Versioned fixtures make stale, missing, conflicting, historical, authorization, and lifecycle states reproducible. A fixture may not pretend that a live company is currently in a state created only for testing.

### Named real references

| Role | Primary | Fallback | Unique coverage |
|---|---|---|---|
| TWSE golden path | `2330 / TWSE` TSMC | `2454 / TWSE` MediaTek | Complete TWSE operating-company report and default multiple path |
| TPEx golden path | `5274 / TPEX` ASPEED | `8299 / TPEX` Phison | Complete TPEx report and board-specific routing |
| ETF-limited | `0050 / TWSE` Yuanta Taiwan 50 ETF | `006208 / TWSE` Fubon Taiwan 50 ETF | Price, distributions, limited overlay, and no operating-company research |
| Identity-only | `020032 / TWSE` Yuanta Green Energy ETN | `020029 / TWSE` Yuanta ESG High Dividend ETN | Unsupported-instrument routing and explicit non-applicability |
| Cyclical normalization | `2002 / TWSE` China Steel | `2603 / TWSE` Evergreen Marine | Mid-cycle earnings, peak/trough treatment, or valid withholding |
| Unsupported-sector valuation | `2881 / TWSE` Fubon Financial | `2882 / TWSE` Cathay Financial | No improvised sector method when common methods are unfit |
| DCF cross-check | `2412 / TWSE` Chunghwa Telecom | `3045 / TWSE` Taiwan Mobile | FCFF bridge, terminal gates, and sensitivities |
| Short listing history | `7811 / TPEX` Minson Integration | `7768 / TWSE` Praise Victor Industrial | Short point-in-time analysis and history-dependent withholding |
| Venue transfer | `5236 / TWSE` Sunplus Innovation | `6589 / TWSE` TaiMed Biologics | Immutable former/current Listings and no automatic history stitching |

Selection was checked against official exchange records on 2026-08-27. Useful official anchors include the [TWSE 2026 Fact Book](https://wwwc.twse.com.tw/downloads/zh/about/company/factbook/2026/1.04.html), [TPEx market-value report](https://www.tpex.org.tw/web/stock/aftertrading/daily_mktval/mkt_result.php?l=en-us&o=htm), [TWSE ETF pages](https://www.twse.com.tw/en/ETFortune-institute/index), [TWSE ETN listing](https://www.twse.com.tw/rwd/en/esg-index-product/etn), [TWSE latest listings](https://www.twse.com.tw/en/company/newlisting?response=html), and the [TPEx Minson listing notice](https://wwwov.tpex.org.tw/web/bulletin/announcement/announce_detail.php?doc_id=11360&l=en-us&sid=0).

The baseline fixture bundle uses one completed Taiwan trading-day cutoff after mandatory daily datasets are due and one `knowledgeAt` after relevant grace windows. Historical, deadline, transfer, correction, and invalidation cases declare separate cutoffs. Every matrix revision records the selector, immutable Listing ID when available, validation date, and substitution rationale.

## Fixture evidence contract

Every deterministic fixture records:

- publisher and Access Provider;
- artifact or permitted excerpt, content hash, source location, and usage/retention status;
- `retrievedAt`, `publishedAt`, `effectiveAt`, and `knowledgeAt`;
- Issuer, Security, and effective Listing identifiers;
- raw value, labels, unit markers, and qualifiers;
- normalized value, unit, scale, period, basis, and parser/normalization version;
- contract, dataset-definition, metric, freshness, and runtime-policy versions;
- expected freshness, completeness, confidence, readiness, conflicts, gaps, conclusions, and recovery requirements.

Adverse fixtures begin with an authentic captured base and an explicit mutation recipe. Examples include removing a period, advancing evaluation time, changing a fallback value, corrupting a unit marker, revoking scope, or making an FX input unavailable. Pure synthetic evidence is limited to contract states that cannot be safely captured and is labelled `synthetic`.

If source terms prohibit redistribution, the artifact remains in controlled storage; the fixture manifest retains its hash, source location, access date, and reproducible retrieval instructions. Private portfolio fixtures are entirely synthetic and contain no production-derived user data.

## Source-faithfulness and data-state evidence

An observation is source-faithful only when an evaluator can verify its subject, period, value, unit, scale, basis, qualifiers, and publication context at the cited artifact location. A working URL or publisher name alone is insufficient.

Each authoritative route receives at least one successful real observation per applicable board. Board-specific datasets also receive deliberate cross-board misrouting tests. Ticker equality never authorizes attachment; venue and effective Listing identity control routing.

The shared data-quality suite covers:

- `not_yet_due`, grace-period `indeterminate`, `stale`, and recovery;
- `not_published`, `source_unavailable`, and `processing_failed`;
- `complete`, `partial`, `empty`, `indeterminate`, and `not_applicable`;
- official `no_activity` without a fabricated numeric zero;
- authoritative retained-data expiry and visibly provisional fallback selection;
- conflict lifecycle `open`, `explained`, `resolved`, and `dismissed`;
- immutable correction, retraction, `supersedes`, and recalculation lineage.

Conflict evidence distinguishes:

1. representational equality inside declared rounding precision — no conflict;
2. genuine but non-decision-material disagreement — authoritative selection plus degradation;
3. disagreement capable of reversing a scenario, threshold, category, or recommendation condition — blocked conclusion.

The suite separately covers explicit zero, blank, dash, `N/A`, no-trade marker, unknown unit/scale, basis changes, and subject ambiguity. Missing values are never zero-filled. Window tests exercise every declared minimum and exactly one observation short, without interpolation. Calendar tests cover holidays, typhoon closures or cancelled sessions, no-activity markers, boundary dates, statutory deadline variations, early filings, and grace transitions.

Historical evidence covers `effective`, `as_recorded`, and `re_evaluate`. Re-evaluation requires a named immutable policy set. Later corrections, later web content, and current state cannot leak into a historical `knowledgeAt`.

## MCP and contract evidence

G2 freezes a conformance suite for the 14 KZO-239 research tools and the approved additive `search_instruments` behavior. Every tool independently proves:

- concrete input and output schema validation;
- authorization and redaction;
- one immutable Listing subject;
- fixed temporal and policy context;
- applicable ranges, windows, pagination, and cursors;
- partial results and response budgets;
- stable tool errors and data-quality results;
- absence of read-side effects.

Research reads are store-only. They never contact a provider, enqueue acquisition, populate a cache, change freshness, or write canonical evidence. A missing stored fact returns a typed quality result and recovery requirement.

One composed run reuses the manifest-resolved selector, `effectiveAt`, `knowledgeAt`, assessment mode, and compatible contract/policy versions. `effectiveAt > knowledgeAt`, cursor mutation, contract mixing, policy mixing, and silent following across a venue transfer fail explicitly.

Bounded-output cases cover maximum windows, cursor integrity and expiry, whole-record response truncation, `record_too_large`, `rate_limited` with `retryAfter`, retry policy, and run-budget exhaustion. Completed trustworthy work remains visible when expansion stops.

Stale, missing, partial, fallback, conflict, and withheld conclusions are successful typed data-quality results. Invalid input, authentication failure, rate limit, oversized record, disabled research surface, and internal failure remain tool errors. Neither class masquerades as the other.

## Report evidence

The two golden paths independently produce a complete, decision-grade full report: one TWSE and one TPEx. End-to-end coverage also includes:

- full operating-company report;
- one focused report for every independently gated conclusion;
- degraded but trustworthy report;
- historical report;
- ETF-limited report;
- identity-only report.

Operational `reportStatus` (`complete`, `partial`, `failed`) remains independent from readiness and conclusion state. A complete report may correctly withhold its final recommendation. Section states and claim support categories receive explicit cases; null, zero, empty prose, and silent omission never encode semantic missingness.

The structured artifact is authoritative. Traditional Chinese and English renderings must preserve sections, states, claim markers, evidence, assumptions, conflicts, withholding reasons, and recovery requirements without introducing claims. Original official titles and materially ambiguous Chinese terms remain visible; material translation uncertainty degrades or withholds the dependent claim.

Every externally verifiable fact and material conclusion has non-dangling lineage through claims, evidence, assumptions, calculations, and conclusion gates. Exact assertions apply to schemas, IDs, states, gates, calculations, lineage, and prohibited content. Bounded semantic assertions apply to prose because V1 promises reproducible evidence and reasoning, not byte-identical wording.

Every final-recommendation gate fails independently in at least one case: identity, settled price, latest due revenue, required financial statements, current announcement collection, decision-grade valuation, supported confidence, and freedom from decision-material conflict. The result names the failed dependencies and recovery requirements, preserves independent facts, and never emits Hold, neutral wording, price comparison, margin of safety, or action language.

Each optional evidence class is also removed independently. Exchange valuation references, institutional trading, foreign ownership, margin/short balances, investor materials, and generally optional dividend evidence degrade only their dependent purposes unless the report explicitly uses them for a conclusion.

Supplementary web cases cover accessible dated evidence, inaccessible/paywalled content, metadata-only items, post-cutoff publication, unverifiable historical content, and unconfirmed material news. None can satisfy an official-data gate or silently become a model assumption.

## Valuation evidence

The valuation suite exercises every method-fitness value (`fit`, `cross_check_only`, `unfit`, `indeterminate`) and assessment readiness (`decision_grade`, `illustrative`, `withheld`). Exactly one method is primary; methods are never averaged.

Mandatory branches include:

- profitable issuer using scenario earnings multiples;
- cyclical issuer using defensible mid-cycle normalization;
- a scenario crossing zero and withholding the multiple-derived range;
- DCF as a qualified cross-check;
- documented DCF-primary override fixture;
- DCF rejection through terminal-value share or another fitness gate;
- fewer than three qualified peers;
- material primary/cross-check disagreement;
- going-concern or unsupported structure without improvised fair value.

Valid and invalid Bear/Base/Bull constructions cover coherent ordered values, non-monotonic values, attempted probability weighting, mismatched denominator basis, and an extreme stress outside the scenario envelope. Invalid constructions remain diagnostic and withhold the affected result rather than being silently repaired.

Peer acceptance uses a frozen universe of at most eight candidates with qualification evidence, inclusions, exclusions, and stopping point. One set yields at least five qualified peers; another yields fewer than three. Statistical extremeness alone never removes a peer.

DCF vectors reproduce forecast cash flows, stubs, discount exponents, WACC inputs, terminal economics, sensitivities, enterprise-to-equity bridge, and diluted-share bridge. A terminal value above 75% makes DCF cross-check-only. “Net debt” is not an unexplained plug.

Thesis monitoring is a stateful sequence:

`within thesis → watchpoint → missing/stale evidence (indeterminate) → confirmed invalidation → old posture withheld → new scenario set`

Later recovery does not erase historical invalidation, and the former Bear case is never promoted automatically.

## Portfolio evidence

The same security, evidence cutoff, and assumptions run without a portfolio, with a held position, and with a non-held position. After normalizing run identifiers, the core research sections, valuation, and security-level recommendation must match. Only the private overlay differs.

The authorization matrix covers no overlay request, authorized self, research-only denial, portfolio denial with unchanged core research, delegated factual access without directional authority, ambiguous delegation, stale or revoked scope, and separation of personal and delegated portfolios.

One canonical synthetic multi-account, multi-currency, long-only ledger supplies mutation-derived cases for:

- held and non-held positions;
- failed or uncommitted projections;
- ambiguous legacy mapping;
- missing subject or denominator prices;
- missing/conflicted FX;
- asynchronous closes near a threshold;
- historical snapshot support;
- action-policy and sizing cases.

The action-policy suite proves facts-only output without a complete policy, no normalization of vague preferences, the distinct meanings of `addition_ceiling`, `reduce_above`, and `acceptable_band`, zero-position non-applicability, conflicting-rule withholding, and invalidation precedence. Maintain is never a residual category.

Sizing covers signed whole shares, gross notional, target weight, maximum weight, both funding models, omitted-funding bounded comparison, lower/upper whole-share outcomes, reduction capped at holdings, residual cash, full-precision threshold evaluation, and the three-alternative limit.

ETF-limited overlay acceptance permits position, cost, distributions, concentration, and hypothetical facts. Operating-company valuation and directional ETF action implications remain `notApplicable`.

The transaction boundary is non-waivable. Even with direction, quantity, account scope, and assumed price, research performs no transaction tool call, draft, preview, executable-field enrichment, confirmation control, deep link, or automatic carryover.

## Compatibility, security, and operations evidence

The legacy oracle is a named pre-research commit plus fixtures for every existing tool’s schema, authorization, representative result, and error. Live production behavior may inform fixture capture but is not the sole oracle.

The frozen suite runs:

1. after additive migrations with research disabled;
2. after shadow acquisition/backfill;
3. with research exposed;
4. after rollback.

The approved `search_instruments` additions are tested separately. Research-only discovery is Taiwan-limited; existing portfolio-authorized discovery retains approved multi-market behavior.

Telemetry tests positively verify provider × dataset × board × operation dimensions, outcomes, latency, response size, records, retries, correlation, and policy versions. Negative tests reject credentials, tokenized URLs, raw provider payloads, portfolio facts, internal paths, stack traces, and infrastructure topology.

The rollback lifecycle exercises scoped dataset/board/tool disable, critical global disable, in-flight fail-closed behavior, preserved legacy operation, quarantine, idempotent rebuild, visible report invalidation, restoration, and a renewed healthy window.

A temporary provider outage does not by itself fail deterministic implementation conformance when the system returns the correct quality state. It does block rollout readiness until KZO-243’s required live-source health window passes.

## Harness and backend ownership

Every acceptance row names its layer, command family, backends, owner, and reviewers. Intended layers are:

- specification/schema validation;
- deterministic unit and calculation vectors;
- memory-backed integration;
- managed Postgres/Redis integration;
- OAuth HTTP/MCP contracts;
- Skill/report conformance;
- deployed-dev live-source validation;
- production rollout observation.

Deterministic G2 behavior runs against both memory and managed Postgres/Redis where persistence is material. The memory backend proves contract portability. Postgres/Redis proves migrations, persistence, immutable lineage, identity resolution, cache boundaries, and rollback behavior. Live-source evidence is separate.

The repository’s eight-suite definition of “all tests pass” remains unchanged. Future implementation planning must map new commands into that workflow and keep scripts and documentation synchronized.

## Review, manifests, reruns, and waivers

Required approvals are:

- G1: domain/product owner, implementation architect, and test owner;
- G2: engineering owner and independent QA reviewer, plus security/privacy review for authorization and portfolio cases;
- G3: release owner and operations/on-call owner.

No author is the sole approver of their own evidence. Judgment-bearing golden reports additionally require independent review of source fidelity, translation ambiguity, peer comparability, normalization, scenario coherence, catalysts/risks, and recommendation wording.

Every gate attempt creates an immutable Acceptance Manifest containing:

- commit SHA, migrations, schemas, and contract versions;
- policy set and configuration snapshot;
- matrix version and hash;
- fixture bundle and hashes;
- environment and backend;
- acceptance-ID results and evidence artifacts;
- reviewers, approvals, waivers, limitations, and timestamps.

Reruns append. A passing rerun supersedes a failure only after the cause and corrective change are recorded; it never erases prior evidence. Unexplained flakiness blocks the gate.

The following are never waivable: security, authorization, privacy partitioning, identity/venue attachment, source authority, version consistency, canonical integrity, mandatory conclusion withholding, transaction boundary, and legacy compatibility. A time-bounded waiver may cover only optional evidence degradation or a noncritical operational target and must name its owner, rationale, affected acceptance IDs, expiry, compensating controls, and release-owner approval.

## Parent-map reconciliation

| KZO-234 item | Disposition |
|---|---|
| Persistence and cache shape | KZO-237 fixes storage-independent semantics; KZO-243 fixes Postgres authority, Redis boundaries, cache identity, migrations, and rebuild. Physical tables/indexes are implementation mechanics. |
| Scheduling, backfill, rate limits, degradation | KZO-243 fixes queue priority, provider coordination, backfill budget, retries, runtime budgets, circuit breakers, and degradation boundaries. Worker topology is implementation-only. |
| Skill packaging | KZO-240 fixes the public orchestrator, eleven internal components, typed fragments, run ledger, and composition boundary. Package/file layout is implementation-only. |
| Sector-specific valuation exceptions | KZO-241 fixes the common-method boundary and explicitly defers unspecifed sector methods. V1 withholds rather than improvises. |
| Rollout and migration sequencing | Resolved by KZO-243. |
| Security, observability, and support runbooks | Authorization and privacy are fixed by KZO-239/KZO-242; observability, alerts, retention, rollback, and the required GA runbook are fixed by KZO-243. Concrete dashboards and runbook files are implementation/operations deliverables. |

No decision-level open question remains for KZO-244.

## Implementation-only deferrals

These items do not change the accepted behavior and therefore may be decided during implementation planning. They are not permission to weaken an acceptance case.

| Deferral | Boundary | Owner role | Planning destination |
|---|---|---|---|
| Physical research tables, indexes, and partitions | Must preserve KZO-237 semantics and KZO-243 durability, migration, quarantine, and rebuild rules | Research backend owner | Persistence workstream |
| Worker, queue, and scheduler topology | Must preserve KZO-243 priorities, budgets, circuit breakers, and independent gates | Research acquisition owner | Acquisition workstream |
| Skill package and file layout | Must preserve KZO-240’s one public orchestrator, typed specialists, shared run ledger, and composer boundary | Skill orchestration owner | Skill packaging workstream |
| Test filenames and fixture storage implementation | Must preserve the matrix IDs, harness layers, fixture contract, and dual-backend coverage | Test owner | Acceptance harness workstream |
| Concrete dashboards, alerts, and runbook files | Must implement KZO-243’s telemetry, thresholds, retention, operator controls, and recovery procedures | Operations owner | Operational readiness workstream |

Sector-specific valuation methods are not an implementation deferral. They are outside V1 and require a separate behavioral decision before use.

## Risk register

| Risk | Consequence | Control and acceptance evidence |
|---|---|---|
| A real reference delists, transfers, or changes economic structure | A live case no longer exercises its intended branch | Primary/fallback roles, phase revalidation, matrix stewardship, and versioned promotion |
| Live sources are temporarily unavailable | Availability is confused with implementation correctness | Deterministic replay for G2; healthy observation windows for G3 |
| Source terms restrict artifact redistribution | Fixtures lose auditability or violate usage terms | Controlled storage, content hashes, rights metadata, and reproducible retrieval instructions |
| Full state cross-products make the suite unmaintainable | Slow, redundant, or abandoned acceptance | Shared-envelope conformance plus per-dataset, mandatory-gate, optional-degradation, and unique-branch cases |
| Narrative output varies between runs | Brittle snapshots obscure semantic regressions | Exact structured assertions plus bounded semantic and independent human review |
| Portfolio facts leak into core research or telemetry | Privacy breach and corrupted recommendations | Differential core hashes, authorization matrix, private partitioning, and forbidden-field scans |
| Specification artifacts drift from Linear decisions | False completeness and contradictory implementation | Closed authoritative corpus, canonical registry, immutable IDs, schema validation, and contradiction log |
| A passing retry hides flakiness | Unreliable evidence supports promotion | Append-only attempts, recorded corrective change, and zero unexplained flakiness |

## Handoff checklist

Implementation planning may begin only when the applicable G1 manifest proves:

- the normative requirement index and immutable acceptance IDs are complete;
- the matrix and schema validate with zero warnings;
- reference subjects, fallbacks, cutoffs, and stewardship are recorded;
- fixture rights, artifacts/hashes, and mutation recipes are complete;
- machine-readable tool/report schemas have valid and invalid examples;
- every deterministic formula has full-precision test vectors;
- error, state, degradation, withholding, and prohibition cases are present;
- every case has a harness, backend, owner, reviewer, and oracle;
- reviewer and waiver policies are accepted;
- KZO-243 rollout evidence is referenced, not duplicated;
- KZO-234 gaps are reconciled;
- implementation-only deferrals are bounded and owned;
- the risk register is present;
- decision-level open questions and contradictions are zero.

This resolution defines acceptance behavior and evidence. It does not implement research schemas, tools, acquisition, storage, Skill files, tests, monitoring, transactions, or rollout.
