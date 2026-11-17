"use client";

import type { CapitalReductionGenerationDto, CapitalReductionValuationDto, LocaleCode } from "@vakwen/shared-types";
import { Button } from "../../components/ui/Button";
import { formatCurrencyAmount } from "../../lib/utils";
import type { CapitalReductionCopy } from "./i18n";

export function CapitalReductionValuation({ valuation, generation, copy, locale, onRetry, busy = false }: {
  valuation: CapitalReductionValuationDto; generation?: CapitalReductionGenerationDto; copy: CapitalReductionCopy;
  locale: LocaleCode; onRetry?: () => void; busy?: boolean;
}) {
  const money = (value: number | null) => value === null ? copy.incomplete : formatCurrencyAmount(value, "TWD", locale);
  const current = !generation || generation.status === "current";
  return <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-4" data-testid="capital-reduction-valuation">
    <h5 className="font-semibold">{copy.valuation}</h5>
    <p className={valuation.status === "INCOMPLETE" ? "text-amber-700" : "text-sm text-muted-foreground"} data-testid="capital-reduction-valuation-status">{copy[valuation.status]}</p>
    <p className="text-xs text-muted-foreground">{copy.valuationDate}: {valuation.valuationDate ?? copy.incomplete}</p>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[[copy.sharePrice, valuation.sharePrice], [copy.shareValue, valuation.deliveredShareValue], [copy.receivableValue, valuation.repaymentReceivableValue], [copy.fractionValue, valuation.pendingFractionValue], [copy.totalValue, current ? valuation.totalAssetValue : null]].map(([label, value]) => <div key={String(label)}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{money(value as number | null)}</dd></div>)}
    </dl>
    {valuation.unresolvedFees ? <p className="text-sm text-amber-700">{copy.unresolvedFees}</p> : null}
    <p className="text-xs text-muted-foreground">{copy.navHelp}</p>
    {generation ? <CapitalReductionGenerationStatus generation={generation} copy={copy} onRetry={onRetry} busy={busy} /> : null}
  </section>;
}

export function CapitalReductionGenerationStatus({ generation, copy, onRetry, busy = false }: { generation: CapitalReductionGenerationDto; copy: CapitalReductionCopy; onRetry?: () => void; busy?: boolean }) {
  const current = generation.status === "current";
  return <div className="space-y-2 border-t border-border pt-3" data-testid="capital-reduction-generation">
    <h6 className="text-sm font-medium">{copy.generation}</h6>
    <p role="status" className={current ? "text-sm text-emerald-700" : "text-sm text-amber-700"}>{copy[generation.status]}</p>
    <p className="text-xs text-muted-foreground">{copy.fromDate}: {generation.fromDate} · {copy.updated}: {generation.updatedAt}</p>
    {generation.error ? <p role="alert" className="text-sm text-destructive">{generation.error}</p> : null}
    {generation.retryable && onRetry ? <Button variant="secondary" size="sm" onClick={onRetry} disabled={busy} data-testid="capital-reduction-retry-generation">{copy.retry}</Button> : null}
  </div>;
}
