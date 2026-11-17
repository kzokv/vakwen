# Cash capital reduction — implementation proposal

Status: Accepted 2026-11-16. Shared understanding confirmed; design interview complete. Accepted decisions and source provenance are recorded in [ADR-0002](../003-adr/0002-capital-reduction-posting-before-reconciliation.md). The engineering contracts below are accepted as the implementation design. Implementation is requested under KZO-270; production posting is not authorized.

## Problem and scope

The existing position-action ledger supports stock dividends, splits, and reverse splits, but not the coordinated quantity, acquisition-cost, repayment-receivable, cash, fee, and fractional-settlement changes of a cash capital reduction. A fake sale or an ordinary dividend receipt cannot represent the required behavior.

First release: user-confirmed announcement terms and account settlement evidence, contextual web entry, MCP preview/post/reconcile/amend operations, and explicit confirmation. Automatic announcement ingestion and scheduled posting are deferred. The motivating case requires cash capital reduction; loss-offset reduction has not been designed.

Accepted market boundary: Taiwan-listed stocks on TWSE and TPEx, with TWD-denominated holdings and settlements. Foreign-currency conversion and overseas corporate-action rules are deferred.

## Accepted behavior

- Reuse security announcement terms while posting each brokerage account separately.
- Permit only one active account action per announced event. Link all receipts, fractional settlement, amendments, and void history to that record. New announcement versions do not silently change posted account actions.
- Preserve reduction, suspension, exchange-record, conversion-effective, scheduled-payment, and actual-receipt dates independently.
- During suspension before conversion, carry forward the last position value with suspension status and its original valuation date.
- Calculate entitlement over the entire eligible account holding before allocating to original lots. Preserve purchase identities and aggregate quantities and cost.
- Retain existing weighted-average cost accounting for adjusted holdings and subsequent sales. Original purchase identities and conversion lineage remain auditable; do not introduce independent lot-cost or FIFO costing.
- Allocate whole shares by largest fractional remainder after assigning each lot its whole theoretical portion. Break ties by opening date, opening sequence, then lot ID. Lot quantities sum to the account's expected whole-share total; track the remaining account fraction separately.
- Keep acquisition costs at two-decimal precision, calculate payout rounding once at account scope according to announcement terms, and allocate monetary remainders deterministically while preserving each aggregate amount exactly.
- Block conversion if confirmed delivered shares differ from calculated whole-share entitlement; require corrected inputs/evidence instead of inventing a balancing adjustment. For the synthetic fixture, compare with floor(542.0491512) = 542, not with the unrounded quantity; pending fractional settlement does not block that valid conversion.
- At conversion, reduce stock cost by gross capital repayment and recognize a repayment receivable. Receipt settles the receivable into net cash and separately recorded bank fees; the bank fee reduces net return without capitalizing stock cost.
- Support partial receipts: reduce the receivable by each gross amount settled, preserve the unpaid balance, and never repeat share conversion or cost reduction. Block settlement beyond the remaining receivable rather than inventing an overpayment classification.
- Track fractional entitlement separately from delivered tradable shares. Allocate residual cost proportionally between delivered shares and the fraction. Recognition of settlement requires actual confirmation.
- Value a pending fraction using the published settlement formula when inputs are available, labeling the gross value as estimated and disclosing unresolved fees. Keep allocated cost separate; unavailable formula inputs mean incomplete valuation. Never treat the estimate as received cash or realized settlement.
- Support fractional proceeds applied against fees, without manufacturing cash deposits. Preserve gross proceeds, fee, offset, and residual balances separately.
- Treat confirmed fractional processing fees as separate expenses reducing net return, without capitalizing stock cost or deducting the expense twice. Fractional settlement result uses gross proceeds minus the fraction's allocated cost.
- Permit posting confirmed components while reconciliation remains open. Do not infer receipts or fees from schedules or unexplained differences.
- Corrections preserve prior versions, require a new confirmed preview, and replay affected history. Adding settlement must not repeat conversion or repayment.
- Support audited voiding of erroneous postings with preview and confirmation, including linked settlement effects. Block invalid replay; no real bank or brokerage transaction is initiated.
- Block amendments that make later sales exceed revised available shares; show the conflict and preserve all existing records without partial mutation. The user's manual-revision question was clarified as checking the valid whole-share result, not requesting an override.
- After conversion, use a quote matching the new-share basis, otherwise a labeled official reference price. Without either, disclose incomplete valuation and withhold affected returns.
- Block first-release posting if gross repayment exceeds the eligible holding's remaining cost or if repayment allocated by eligible shares exceeds an individual lot's remaining cost. Do not shift the excess to another lot or merge purchase histories to bypass this guard.

## Synthetic acceptance fixture

All quantities, costs, receipts and fees in this fixture are invented for testing; they do not describe any real portfolio. The published public replacement ratio is used to exercise precision.

| Component | Synthetic result |
| --- | --- |
| Old quantity / cost | 1,000 shares / TWD 30,000 |
| Replacement ratio | 542.0491512 / 1,000 |
| Theoretical quantity | 542.0491512 |
| Whole quantity / pending fraction | 542 / 0.0491512 |
| Gross repayment | TWD 4,579 |
| Illustrative bank fee / net receipt | TWD 5 / TWD 4,574 |
| Residual cost | TWD 25,421.00 |
| Delivered-share cost / fraction cost | TWD 25,418.69 / TWD 2.31 |
| Expected gross fractional proceeds at TWD 56.70 | TWD 2, not confirmed settlement |

The public suspension and exchange dates may be used as dated fixtures, but no actual account evidence is included. The delivered whole-share quantity must pass while fractional settlement remains pending.

## Implementation shape

Extend the existing position-action and historical-replay infrastructure with an explicit `CASH_CAPITAL_REDUCTION` action. Keep typed capital-reduction details and independently dated settlement facts, linked to the account action and announcement version, rather than overloading split cash-in-lieu or dividend source lines.

Use a shared domain calculator to produce quantity, lot-cost, receivable, settlement, fee, and valuation effects. Web preview, MCP preview, posting, and historical replay must use the same rules. Existing split code floors each lot independently and must not be reused unchanged for this event. Do not silently alter legacy split semantics as part of this work.

Preview contract: show source evidence, eligible historical lots, all relevant dates, account-level expected and confirmed quantities, lot allocations, gross/net settlement components, receivables, fees, fractional status, changed subsequent sale results, and affected historical valuations. Distinguish warnings from blocking errors.

Confirmation contract: bind an expiring, single-use preview to the authenticated actor, portfolio/account scope, input digest, and relevant accounting revisions. Recheck permissions and revisions under the existing write-lock/transaction boundary. Changed inputs or history require a fresh preview. Retries return the existing result without duplicate effects.

Persistence contract: commit source facts and affected accounting projections atomically in memory and Postgres implementations. Make the action recoverable through replay; never persist only an edited holding balance. Invalidate affected snapshots and caches without presenting stale results as current. Add durable reconciliation and amendment history, with current and superseded versions distinguishable.

Web surface: holding-detail capital-reduction entry, sourced announcement fields, expected-versus-actual preview, confirmation, timeline entry, suspension/reference valuation labels, and a later settlement/reconciliation view. Mirror these capabilities in MCP; final operation names remain to be chosen.

## Affected areas

- API position-action types, shared DTOs, schemas, accounting store, and replay calculator.
- Memory and Postgres persistence, schema constraints and migrations, locking and idempotency.
- Dividend eligibility replay and other consumers of position actions, including SQL-based replay, must understand converted quantities without treating repayment as dividend income.
- Cash, receivable, fractional entitlement, fee, realized-result, NAV, performance, and historical snapshot projections.
- API routes, MCP registration/policies/confirmation flow, contextual web UI and translations.

## Validation plan

Start with domain examples: 3714 exact arithmetic, rounding across multiple lots, cost conservation, pending versus settled fractions, fee offset without cash, separate conversion/receipt dates, and reference-price fallback. Cover event ordering, later sells, repeated replay, duplicate submissions, stale previews, audited amendments, and forbidden cross-account access.

Verify route and MCP parity, rollback on replay/persistence failure, and real Postgres constraints and replay using the managed host/container integration command required by repository policy. Add focused web and MCP acceptance coverage. Report the suites actually executed; do not claim all eight repository suites passed unless all eight ran cleanly.

## Engineering contracts

### Identity and versioning

Give announcements a stable internal event ID tied to the security and listing venue, with immutable versions containing the source reference, published ratio, rounding terms, schedule, and available official valuation inputs. Dates and source URLs are attributes, not mutable record identity. Compare official event references and security/schedule signatures when manually entered terms might duplicate an existing announcement; ambiguous matches require resolution rather than silently creating a second event. A reused public announcement must not expose another account's private evidence.

An account action pins an announcement version. Its conversion effect uses the stable account-action ID and active confirmed revision. Settlement components have their own stable IDs and actual dates. Enforce one active account action per account/event with a durable uniqueness constraint; changing dates or descriptive labels cannot bypass it. A voided action remains part of the same account/event history; restoring a mistaken void uses a new confirmed revision of that history rather than a second independent conversion.

### Arithmetic and allocation

Use exact decimal or integer-rational arithmetic for published inputs; do not truncate a ratio to a convenient percentage or allow binary floating-point noise to choose a share or cent recipient. Represent currency amounts in minor units for allocation, and preserve source precision separately.

1. Replay the eligible account/security history to immediately before conversion, using the existing weighted-average method. Validate eligible quantities and costs.
2. Compute theoretical account quantity, expected whole quantity, residual fraction, and gross repayment under the pinned announcement rules. For this release, the capital-reduction workflow handles the whole-share delivery plus separate fraction, without elective fraction-combining adjustments. Confirmed delivery must match the calculated whole quantity.
3. Allocate new whole shares by the accepted largest-remainder rule, with opening date, opening sequence, and lot ID as tie breaks.
4. Allocate the rounded aggregate repayment across eligible lots by their old-share weights. Calculate quotas at the applicable monetary precision, assign floors, then distribute remaining units by descending remainder and the same tie breaks. Reject an allocation that exceeds a lot's normalized remaining cost.
5. Subtract gross repayment from total eligible cost. Split that residual cost in cents between whole delivered shares and the account fraction using their shares of theoretical converted quantity. Assign floors and distribute remaining cents by descending remainder; use a stable component order for exact ties. Never derive fractional value from the rounded displayed average cost.
6. Distribute the delivered-share cost over retained whole-share lots by new quantities using the same monetary conservation rule. Lots allocated zero new shares have zero retained cost, but their original purchase facts and conversion contributions remain in the audit allocation. This is weighted-average allocation, not a sale or a new purchase.

Retain the ratio-based entitlement calculation even when the source ratio has more than six decimal places. Display rounding must not change settlement calculations. When the theoretical fraction is zero, create no fractional entitlement or fractional cost. When no whole shares remain, retain the residual cost on the fractional entitlement and create no positive-quantity holding; later fractional settlement determines its outcome.

### Reconciliation and lifecycle

Track repayment and fractional reconciliation separately. An action is reconciled only when all required components are settled and known differences have explicit classifications; a zero cash deposit alone does not settle a fraction. A draft or preview is not a posted financial fact. A posted action may remain pending or partially reconciled. A void is a separate audited lifecycle state, not a reconciled event.

For repayment receipts, settle only explicitly supported gross components. Net cash plus confirmed deductions must equal the gross portion settled. If only net cash is confirmed, settle that supported amount and leave the unexplained balance receivable until its classification is confirmed; do not invent a fee. Later classification can settle that balance without repeating the bank deposit. Block negative amounts, unbalanced components, duplicate evidence/application, or amounts above the outstanding receivable.

For fractional settlement, record gross proceeds, cost derecognition, processing expense, fee-offset amount, actual residual cash, and any supported outstanding fee separately. The offset may not exceed either the supported fee or available proceeds. Until confirmed, the calculated expected TWD 2 remains an estimated asset value, not a cash receipt or realized result. On settlement, replace the pending asset with the actual settlement effects and recognize gross proceeds less allocated cost separately from the fee expense. Partial components must not derecognize the same cost twice.

Preview amendments and voids against the complete linked conversion and settlement history. Explicitly enumerate facts being superseded/voided, proposed replacements, cash and receivable differences, subsequent sale changes, and historical snapshots requiring regeneration. Preserve evidence and actor/reason information. Block invalid replay, settlement exceeding a revised entitlement, or omitted dependent effects. A void covers the erroneous action and its dependent settlement effects together; it does not claim a real-world refund occurred. No general coordinated trade-repair feature or force-post bypass is included in this design.

### Confirmation, persistence, and reporting

Every mutation is previewed and explicitly confirmed through the shared service. Bind preview to actor, effective portfolio access, account/security/event, input and evidence digest, linked event revisions, and relevant accounting revisions. Expiry or relevant changes require another preview. Validate under a write lock, commit source facts and immediate accounting effects atomically, and record a single-use preview/result mapping for safe retry. Different requests for the same event cannot create two conversions. Later announcement publication does not invalidate an action pinned to an earlier version unless adopting the new version is requested.

Extend the existing ledger/replay stream with the new action and settlement types rather than passing them through a generic split fallback. Audit all action consumers, including PostgreSQL replay/eligibility SQL, snapshots, holdings, lot allocation, cash, fee, receivable, and performance calculations. Replaying must rebuild the same source-linked effects without duplication. Retain existing event behavior and backfill/default new collections for historical stores.

NAV includes delivered shares, outstanding repayment receivables, and any valued pending fraction once each. Capital repayment is a movement between owned assets, not dividend income, trading profit, or an external portfolio contribution. Bank cash appears only on actual receipt. Confirmed fees reduce return once. Estimated reference/fractional values and unknown fee components remain visible in affected reports; missing required valuation inputs mean incomplete totals/returns rather than silently treating an unknown component as zero. Once a matching new-share quote is available, it replaces reference valuation without rewriting the original quote evidence.

Background snapshot rebuilding must expose stale/incomplete status until the affected generation is current; failure must not present mismatched quantity, cost, cash, or price bases as a valid current result. Define retryable regeneration status as part of the implementation, with durable source facts sufficient for recovery.

## Implementation sequence

1. Add typed contracts and the shared exact-arithmetic calculator, including synthetic single- and multiple-lot conservation examples.
2. Extend source facts, replay, receivable/fraction projections, and both persistence backends; add migration constraints and failure/retry coverage.
3. Add shared preview/confirm/reconcile/amend/void service operations and wire API/MCP permissions, scoped reads, duplicate checks, and confirmation.
4. Add contextual web entry, preview and confirmation, timeline/reconciliation controls, and valuation labels.
5. Complete focused domain, API/MCP, managed Postgres, and web acceptance checks, followed by broader regression appropriate to the affected shared accounting paths. Keep the eight-suite full-test claim rule.

Shared understanding has been explicitly confirmed, and implementation is requested under KZO-270. This design acceptance does not authorize recording any real event in any portfolio. Actual fractional-settlement evidence remains pending; concrete DTO names, migration numbering, and file boundaries are implementation details.
