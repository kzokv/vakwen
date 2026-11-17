import type { CapitalReductionAnnouncementPreviewDto } from "@vakwen/shared-types";
import type { CapitalReductionCopy } from "./i18n";
import { CapitalReductionAnnouncementTerms } from "./CapitalReductionAnnouncementTerms";

export function CapitalReductionAnnouncementPreview({ preview, copy, accountName }: { preview: CapitalReductionAnnouncementPreviewDto; copy: CapitalReductionCopy; accountName: string }) {
  return <section className="space-y-4" data-testid="capital-reduction-announcement-preview">
    <h5 className="text-lg font-semibold">{copy.announcementPreview}</h5>
    <p className="text-sm text-muted-foreground">{copy.announcementOnlyHelp}</p>
    <p className="text-sm">{copy.account}: <strong>{accountName}</strong> <span className="text-xs text-muted-foreground">({preview.input.accountId})</span> · {preview.input.announcement.ticker}</p>
    <p className="text-sm">{copy.reason}: {preview.input.reason}</p>
    <CapitalReductionAnnouncementTerms announcement={preview.input.announcement} copy={copy} />
    {preview.blockers.length > 0 ? <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-destructive" data-testid="capital-reduction-announcement-blockers"><h6 className="font-semibold">{copy.blockers}</h6><ul className="mt-2 list-disc pl-5">{preview.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blocker.message}</li>)}</ul></div> : null}
    {preview.warnings.length > 0 ? <div className="rounded-lg border border-amber-300 p-3 text-amber-700"><h6 className="font-semibold">{copy.warnings}</h6><ul className="mt-2 list-disc pl-5">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
  </section>;
}
