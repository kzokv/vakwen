"use client";

import Link from "next/link";
import type { AppDictionary } from "../../../lib/i18n";
import type { LocaleCode } from "@vakwen/shared-types";
import { formatCurrencyAmount, formatDateLabel } from "../../../lib/utils";
import { Drawer } from "../../../components/ui/Drawer";
import type { EnrichedCashLedgerEntry } from "../types";
import { cashLedgerEntryTypeLabel, isCapitalReductionCashType } from "../utils/entryTypes";
import { capitalReductionCashReferences } from "../utils/capitalReductionCashReferences";

interface CashLedgerDrawerProps {
  entry: EnrichedCashLedgerEntry | null;
  onClose: () => void;
  dict: AppDictionary;
  locale: LocaleCode;
}

export function CashLedgerDrawer({ entry, onClose, dict, locale }: CashLedgerDrawerProps) {
  if (!entry) return null;

  const d = dict.cashLedger;
  const references = capitalReductionCashReferences(entry);
  const isCapitalReduction = isCapitalReductionCashType(entry.entryType);
  const isSettlement = entry.entryType === "TRADE_SETTLEMENT_IN" || entry.entryType === "TRADE_SETTLEMENT_OUT";
  const isDividend = entry.entryType === "DIVIDEND_RECEIPT" || entry.entryType === "DIVIDEND_DEDUCTION";

  const title = isSettlement
    ? d.drawerSettlementTitle
    : isDividend
      ? d.drawerDividendTitle
      : isCapitalReduction
        ? d.drawerCapitalReductionTitle
        : d.pageTitle;

  return (
    <Drawer
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={title}
    >
      <div className="space-y-4" data-testid="cash-ledger-drawer">
        <DetailRow label={d.drawerDate} value={formatDateLabel(entry.entryDate, locale)} />
        {entry.ticker && <DetailRow label={d.drawerTicker} value={entry.ticker} />}
        {entry.side && <DetailRow label={d.drawerSide} value={entry.side} />}

        {isSettlement && entry.tradeDetail && (
          <>
            <DetailRow label={d.drawerQuantity} value={String(entry.tradeDetail.quantity)} />
            <DetailRow label={d.drawerUnitPrice} value={formatCurrencyAmount(entry.tradeDetail.unitPrice, entry.currency, locale)} />
            <DetailRow label={d.drawerCommission} value={formatCurrencyAmount(entry.tradeDetail.commissionAmount, entry.currency, locale)} />
            <DetailRow label={d.drawerTax} value={formatCurrencyAmount(entry.tradeDetail.taxAmount, entry.currency, locale)} />
            <DetailRow label={d.drawerNetSettlement} value={formatCurrencyAmount(entry.amount, entry.currency, locale)} />
          </>
        )}

        {isDividend && entry.dividendDetail && (
          <>
            <DetailRow label={d.drawerExpectedCash} value={formatCurrencyAmount(entry.dividendDetail.expectedCashAmount, entry.currency, locale)} />
            <DetailRow label={d.drawerReceivedCash} value={formatCurrencyAmount(entry.dividendDetail.receivedCashAmount, entry.currency, locale)} />
            <DetailRow label={d.drawerDeductionTotal} value={formatCurrencyAmount(entry.dividendDetail.deductionTotal, entry.currency, locale)} />
          </>
        )}

        {isCapitalReduction ? <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" data-testid="cash-ledger-capital-reduction-source">
          <DetailRow label={d.columnType} value={cashLedgerEntryTypeLabel(entry.entryType, dict)} />
          {references.actionReference ? <DetailRow label={d.drawerCapitalReductionReference} value={references.actionReference} /> : null}
          {references.componentReference ? <DetailRow label={d.drawerCapitalReductionComponentReference} value={references.componentReference} /> : null}
          <p className="text-sm text-muted-foreground">{d.capitalReductionSourceNotice}</p>
          <Link href="/portfolio" className="text-sm underline">{d.capitalReductionViewHoldings}</Link>
        </section> : null}

        {!isSettlement && !isDividend && (
          <DetailRow label={d.columnAmount} value={formatCurrencyAmount(entry.amount, entry.currency, locale)} />
        )}
      </div>
    </Drawer>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
      <span className="flex-shrink-0 text-sm text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right text-sm font-medium text-slate-900">{value}</span>
    </div>
  );
}
