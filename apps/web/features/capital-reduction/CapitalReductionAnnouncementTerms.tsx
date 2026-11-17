import type { CapitalReductionAnnouncementDto } from "@vakwen/shared-types";
import type { CapitalReductionCopy } from "./i18n";

/** Public source terms only; delivery and settlement evidence belong to the account action. */
export function CapitalReductionAnnouncementTerms({ announcement, copy }: { announcement: CapitalReductionAnnouncementDto; copy: CapitalReductionCopy }) {
  const terms: Array<[string, string]> = [
    [copy.reference, announcement.officialReference], [copy.sourceVersion, String(announcement.version)],
    [copy.publishedDate, announcement.publishedDate], [copy.venue, announcement.venue],
    [copy.oldShares, announcement.ratioDenominator], [copy.newShares, announcement.ratioNumerator],
    [copy.repaymentPerOldShare, announcement.repaymentPerOldShare],
    [copy.rounding, announcement.payoutRounding === "FLOOR" ? copy.floor : copy.halfUp],
    [copy.referencePrice, announcement.officialReferencePrice ?? copy.incomplete],
    [copy.fractionPrice, announcement.fractionReferencePrice ?? copy.incomplete],
    [copy.reductionDate, announcement.reductionDate], [copy.suspensionStartDate, announcement.suspensionStartDate],
    [copy.suspensionEndDate, announcement.suspensionEndDate], [copy.exchangeRecordDate, announcement.exchangeRecordDate],
    [copy.conversionDate, announcement.conversionTimestamp ?? announcement.conversionDate],
    [copy.scheduledPaymentDate, announcement.scheduledPaymentDate],
  ];
  return <div className="space-y-3">
    <a href={announcement.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-sm underline">{announcement.sourceUrl}</a>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{terms.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm">{value}</dd></div>)}</dl>
  </div>;
}
