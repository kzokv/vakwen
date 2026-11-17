# Vakwen Domain Language

Domain terms for portfolio accounting.

## Capital Reduction

**Capital Reduction Announcement**:
The published terms and schedule of a security's capital reduction, reusable across affected holdings. It does not establish any particular account's delivered shares, deductions, or cash receipts.
_Avoid_: Posted account adjustment, settlement receipt

**Account Capital Reduction**:
The application of a capital reduction to one brokerage account's eligible holding, with its own confirmed quantities, receipts, fees, and reconciliation status.
_Avoid_: Company-wide posting, automatic adjustment of every holding

**Capital Reduction Amendment**:
An explicitly confirmed correction to a posted account capital reduction that preserves the prior version, the reason for correction, and who made it.
_Avoid_: Silent overwrite, replacement trade

**Capital Reduction Trading Suspension**:
The announced period during which a security cannot be traded because of its capital reduction. The suspension period is distinct from the share-conversion effective time and cash-receipt date.
_Avoid_: Market closure, conversion date

**Capital Repayment**:
The gross amount returned to a shareholder through a cash capital reduction, before deductions and separate fractional-share settlement.
_Avoid_: Dividend, net cash receipt

**Capital Repayment Receivable**:
The gross repayment entitlement recognized at share conversion that has not yet been settled. It contributes to portfolio value separately from bank cash and fractional-share entitlement.
_Avoid_: Cash balance, dividend income

**Capital Reduction Cash Receipt**:
The actual cash credited to a shareholder for a capital reduction; its breakdown may remain unresolved even when the credited amount is known.
_Avoid_: Gross repayment, verified cost reduction

**Capital Reduction Reconciliation**:
The determination of how confirmed share delivery and cash receipts correspond to capital repayment, fractional-share settlement, deductions, and unexplained differences. A posted capital reduction can remain unreconciled.
_Avoid_: Posting confirmation, automatic fee attribution

**Pending Fractional-Share Entitlement**:
The fractional entitlement remaining after a share conversion whose settlement is not yet confirmed. It is separate from delivered tradable shares and does not establish that cash has been received.
_Avoid_: Tradable fractional share, received cash in lieu

**Fractional-Share Fee Offset**:
The application of fractional-share settlement proceeds against a processing fee instead of depositing those proceeds as cash. The proceeds, fee, and amount offset remain distinct amounts.
_Avoid_: Missing cash, capital repayment deduction
