# Cash capital reduction with independent reconciliation

Status: Accepted 2026-11-16. Implementation requested under KZO-270. See the [complete design](../001-architecture/cash-capital-reduction.md) for accepted contracts, implementation sequence, and synthetic acceptance fixtures. No real portfolio mutation is authorized.

Extend the replayable position-action model with cash capital reduction while retaining existing weighted-average accounting. Announcement terms are versioned and reusable; an account has one active action per announced event. Calculate whole-share entitlement at account scope before allocating by largest remainder across original lots. Preserve exact cost and cash totals, two-decimal acquisition costs, explicit payout rounding, and original trade facts.

Conversion adjusts quantity and cost and recognizes a repayment receivable. Actual receipts and fees settle independently, including partial receipts. Fractional entitlement has its own allocated cost, estimated settlement valuation, and confirmed settlement; proceeds may offset separately recorded processing fees without a bank deposit. Posting confirmed components does not require inventing unresolved settlement facts. Preserve the difference between source terms, calculated expectations, user confirmation, and actual evidence.

Support web and MCP through one shared preview/confirmation service, with scoped authorization, durable idempotency, stale-preview protection, atomic effects, and historical replay. Amendments and voids preserve versions and evidence, enumerate linked settlement effects, and block invalid subsequent sales. Do not bypass whole-share mismatches or negative-cost/excess-repayment guards.

Suspension and conversion dates have distinct meanings. Carry dated valuation before conversion; afterward use a matching market quote or labeled official reference, otherwise disclose incomplete valuation. Repayment is an owned-asset movement, not dividend income, external contribution, or trading profit. Fees reduce return once; estimated fractional proceeds are not realized receipts.

First release covers Taiwan-listed TWSE/TPEx stocks and TWD holdings/settlements. Automatic ingestion and scheduled posting, loss-offset reduction, foreign-currency/overseas rules, elective fraction combining, and general coordinated trade repair are deferred. This record and the linked specification intentionally contain only synthetic account examples.
