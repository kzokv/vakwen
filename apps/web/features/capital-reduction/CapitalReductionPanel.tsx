"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountCapitalReductionDto, CapitalReductionInputDto, CapitalReductionPreviewDto, CapitalReductionAnnouncementDto, CapitalReductionAnnouncementPreviewDto, CapitalReductionAnnouncementGenerationDto, LocaleCode } from "@vakwen/shared-types";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/shadcn/input";
import { useOptionalAppShellData } from "../../components/layout/AppShellDataContext";
import { formatCurrencyAmount } from "../../lib/utils";
import { announcementToForm, createAnnouncementForm, createFractionSettlementForm, createFractionAdjustmentForm, fractionAdjustmentToForm, createRepaymentForm, toAnnouncement, isFutureCapitalReductionConversion, toFractionSettlement, toFractionAdjustment, toRepayment, type AnnouncementForm, type FractionSettlementForm, type FractionAdjustmentForm, type RepaymentForm } from "./form";
import { getCapitalReductionCopy, type CapitalReductionCopy } from "./i18n";
import { confirmCapitalReduction, confirmCapitalReductionAnnouncement, fetchCapitalReductions, previewCapitalReduction, previewCapitalReductionAnnouncement, retryCapitalReductionGeneration, retryCapitalReductionAnnouncementGeneration, CAPITAL_REDUCTION_CHANGED_EVENT, type CapitalReductionList } from "./service";
import { CapitalReductionPreview } from "./CapitalReductionPreview";
import { CapitalReductionValuation, CapitalReductionGenerationStatus } from "./CapitalReductionValuation";
import { CapitalReductionAnnouncementPreview } from "./CapitalReductionAnnouncementPreview";
import { CapitalReductionAnnouncementTerms } from "./CapitalReductionAnnouncementTerms";

type Operation = CapitalReductionInputDto["operation"];
interface AccountOption { id: string; name: string; currency: string }
const sectionClass = "space-y-4 rounded-lg border border-border/70 bg-background p-4";
const operationLabel: Record<Operation, keyof CapitalReductionCopy> = { POST: "operationPost", RECONCILE: "operationReconcile", AMEND: "operationAmend", VOID: "operationVoid", RESTORE: "operationRestore" };

export function CapitalReductionPanel({ ticker, accounts, locale, onChanged }: { ticker: string; accounts: AccountOption[]; locale: LocaleCode; onChanged?: () => void }) {
  const copy = getCapitalReductionCopy(locale);
  const shell = useOptionalAppShellData();
  const canWrite = shell?.isSharedContext ? shell.sharedContextPermissions.canWriteTransactions : shell?.sessionUserRole !== "viewer";
  const eligibleAccounts = useMemo(() => accounts.filter(account => account.currency === "TWD"), [accounts]);
  const [expanded, setExpanded] = useState(false);
  const [accountId, setAccountId] = useState(eligibleAccounts[0]?.id ?? "");
  const activeAccountId = eligibleAccounts.some(account => account.id === accountId) ? accountId : eligibleAccounts[0]?.id ?? "";
  const [data, setData] = useState<CapitalReductionList>({ actions: [], announcements: [] });
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [announcementOnly, setAnnouncementOnly] = useState(false);
  const [announcementPreview, setAnnouncementPreview] = useState<CapitalReductionAnnouncementPreviewDto | null>(null);
  const [operation, setOperation] = useState<Operation>("POST");
  const [selected, setSelected] = useState<AccountCapitalReductionDto | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementForm>(() => createAnnouncementForm(ticker));
  const [sourceChoice, setSourceChoice] = useState("");
  const [confirmedQuantity, setConfirmedQuantity] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [receipts, setReceipts] = useState<RepaymentForm[]>([]);
  const [fraction, setFraction] = useState<FractionSettlementForm | null>(null);
  const [fractionAdjustments, setFractionAdjustments] = useState<FractionAdjustmentForm[]>([]);
  const [preview, setPreview] = useState<CapitalReductionPreviewDto | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [now, setNow] = useState(0);
  const scopeKey = `${shell?.contextOwnerId ?? shell?.sessionUserId ?? ""}:${activeAccountId}:${ticker}`;

  const activePreview = announcementPreview ?? preview;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  useEffect(() => { setEditing(false); setPreview(null); setAnnouncementPreview(null); setSelected(null); setError(""); setMessage(""); setData({ actions: [], announcements: [] }); }, [scopeKey]);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  useEffect(() => {
    if (!expanded) return;
    const refresh = () => { setLoadVersion(value => value + 1); onChangedRef.current?.(); };
    window.addEventListener(CAPITAL_REDUCTION_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CAPITAL_REDUCTION_CHANGED_EVENT, refresh);
  }, [expanded]);
  useEffect(() => {
    if (!expanded || !activeAccountId) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void fetchCapitalReductions({ accountId: activeAccountId, ticker }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [activeAccountId, ticker, expanded, loadVersion, scopeKey, shell?.contextRefreshSignal]);
  useEffect(() => {
    if (!activePreview && !editing) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activePreview, editing]);
  // Keep durable regeneration progress visible without requiring a page reload.
  useEffect(() => {
    if (!expanded || ![...data.actions.map(action => action.generation), ...(data.announcementGenerations ?? []).map(entry => entry.generation)].some(generation => ["stale", "queued", "running"].includes(generation.status))) return;
    const timer = window.setTimeout(() => setLoadVersion(value => value + 1), 3000);
    return () => window.clearTimeout(timer);
  }, [data.actions, data.announcementGenerations, expanded]);

  function invalidatePreview() { setPreview(null); setAnnouncementPreview(null); setAccepted(false); setError(""); setMessage(""); }
  function begin(action: AccountCapitalReductionDto | null, nextOperation: Operation) {
    invalidatePreview(); setAnnouncementOnly(false); setOperation(nextOperation); setSelected(action); setEditing(true);
    const prior = action?.revisions.at(-1)?.input;
    setAnnouncement(prior ? announcementToForm(prior.announcement) : { ...createAnnouncementForm(ticker), eventId: crypto.randomUUID() });
    setSourceChoice(prior ? `${prior.announcement.eventId}:${prior.announcement.version}` : "");
    setConfirmedQuantity(prior ? String(prior.confirmedWholeQuantity) : "");
    setEvidence(prior?.evidenceReference ?? ""); setReason("");
    setReceipts((prior?.repaymentReceipts ?? []).map(receipt => ({ ...receipt, grossAmount: String(receipt.grossAmount), cashAmount: String(receipt.cashAmount), feeAmount: String(receipt.feeAmount) })));
    setFractionAdjustments((prior?.fractionAdjustments ?? []).map(fractionAdjustmentToForm));
    const priorFraction = prior?.fractionSettlement;
    setFraction(priorFraction ? { ...priorFraction, grossAmount: String(priorFraction.grossAmount), processingFeeAmount: String(priorFraction.processingFeeAmount), feeOffsetAmount: String(priorFraction.feeOffsetAmount), cashAmount: String(priorFraction.cashAmount), feeCashPaidAmount: String(priorFraction.feeCashPaidAmount) } : null);
  }
  function beginAnnouncement() { begin(null, "POST"); setAnnouncementOnly(true); }
  function reuseAnnouncement(source: CapitalReductionAnnouncementDto) {
    begin(null, "POST"); setSourceChoice(`${source.eventId}:${source.version}`); setAnnouncement(announcementToForm(source));
  }
  function resolveSource(): CapitalReductionAnnouncementDto {
    return data.announcements.find(item => `${item.eventId}:${item.version}` === sourceChoice)
      ?? (selected && !["POST", "AMEND"].includes(operation) ? selected.revisions.at(-1)?.input.announcement : undefined)
      ?? (sourceChoice ? selected?.revisions.at(-1)?.input.announcement : undefined)
      ?? toAnnouncement(announcement);
  }
  function chooseSource(value: string) {
    invalidatePreview(); setSourceChoice(value);
    const source = data.announcements.find(item => `${item.eventId}:${item.version}` === value);
    setAnnouncement(source ? announcementToForm(source) : { ...createAnnouncementForm(ticker), eventId: crypto.randomUUID() });
  }
  function changeAnnouncement<Key extends keyof AnnouncementForm>(key: Key, value: AnnouncementForm[Key]) {
    invalidatePreview(); setAnnouncement(current => ({ ...current, [key]: value }));
  }
  function updateReceipt(index: number, next: RepaymentForm) { invalidatePreview(); setReceipts(current => current.map((receipt, itemIndex) => itemIndex === index ? next : receipt)); }

  async function requestPreview() {
    invalidatePreview(); setBusy(true);
    const requestScope = scopeKey;
    try {
      if (!activeAccountId || !reason.trim()) throw new Error("INVALID_FORM");
      const source = resolveSource();
      if (announcementOnly) {
        const result = await previewCapitalReductionAnnouncement({ accountId: activeAccountId, announcement: source, reason: reason.trim() });
        if (scopeRef.current === requestScope) setAnnouncementPreview(result);
        return;
      }
      if (!evidence.trim() || !/^\d+$/.test(confirmedQuantity) || !Number.isSafeInteger(Number(confirmedQuantity))) throw new Error("INVALID_FORM");
      const input: CapitalReductionInputDto = {
        operation, accountId: activeAccountId, ticker, announcement: source,
        actionId: selected?.id, expectedRevision: selected?.revision, confirmedWholeQuantity: Number(confirmedQuantity),
        evidenceReference: evidence.trim(), reason: reason.trim(), repaymentReceipts: receipts.map(toRepayment),
        fractionSettlement: fraction ? toFractionSettlement(fraction) : undefined,
        fractionAdjustments: fractionAdjustments.map(toFractionAdjustment),
      };
      const result = await previewCapitalReduction(input);
      if (scopeRef.current === requestScope) setPreview(result);
    } catch (cause) { setError(cause instanceof Error && cause.message.startsWith("INVALID_") ? copy.invalid : cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!activePreview || !accepted || activePreview.blockers.length || Date.parse(activePreview.expiresAt) <= Date.now()) return;
    setBusy(true); setError("");
    const requestScope = scopeKey;
    try {
      if (announcementPreview) await confirmCapitalReductionAnnouncement(announcementPreview);
      else if (preview) await confirmCapitalReduction(preview);
      if (scopeRef.current !== requestScope) return;
      setEditing(false); setPreview(null); setAnnouncementPreview(null); setAccepted(false); setMessage(announcementPreview ? copy.announcementRegistered : copy.saved);
      setLoadVersion(value => value + 1); onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function retry(actionId: string) {
    setBusy(true); setError("");
    try { await retryCapitalReductionGeneration(actionId); setLoadVersion(value => value + 1); onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function retryAnnouncement(entry: CapitalReductionAnnouncementGenerationDto) {
    setBusy(true); setError("");
    try { await retryCapitalReductionAnnouncementGeneration({ accountId: activeAccountId, eventId: entry.eventId, version: entry.version }); setLoadVersion(value => value + 1); onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  if (eligibleAccounts.length === 0) return null;
  const sourceLocked = Boolean(sourceChoice) || !["POST", "AMEND"].includes(operation);
  const expired = activePreview ? Date.parse(activePreview.expiresAt) <= now : false;
  const futureConversion = isFutureCapitalReductionConversion({ conversionDate: announcement.conversionDate.slice(0, 10), conversionTimestamp: announcement.conversionDate ? `${announcement.conversionDate.slice(0, 16)}:00+08:00` : undefined }, now || Date.now());
  return <section className={sectionClass} data-testid="capital-reduction-panel">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">{copy.title}</h3><p className="mt-1 text-sm text-muted-foreground">{copy.description}</p></div><Button variant="secondary" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="capital-reduction-content" data-testid="capital-reduction-open">{copy.open}</Button></div>
    {expanded ? <div className="space-y-4" id="capital-reduction-content">
      <label className="grid gap-1 text-sm"><span>{copy.account}</span><select className="h-10 rounded-md border border-input bg-background px-3" value={activeAccountId} onChange={event => setAccountId(event.target.value)} disabled={busy} data-testid="capital-reduction-account">{eligibleAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      {!canWrite ? <p className="text-sm text-muted-foreground">{copy.readOnly}</p> : null}
      {error ? <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="rounded-md border border-emerald-300 p-3 text-sm text-emerald-700">{message}</p> : null}
      {loading ? <p role="status" className="text-sm text-muted-foreground">{copy.loading}</p> : <>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setLoadVersion(value => value + 1)} disabled={busy}>{copy.refresh}</Button>{canWrite ? <><Button onClick={beginAnnouncement} disabled={busy} variant="secondary" data-testid="capital-reduction-register-announcement">{copy.registerAnnouncement}</Button><Button onClick={() => begin(null, "POST")} disabled={busy} data-testid="capital-reduction-new">{copy.newAction}</Button></> : null}</div>
        {data.announcements.length > 0 ? <section className="space-y-3" data-testid="capital-reduction-registered-announcements"><h4 className="font-semibold">{copy.registeredAnnouncements}</h4>{data.announcements.map(source => <article key={`${source.eventId}:${source.version}`} className="space-y-3 rounded-lg border border-border p-3"><details><summary className="cursor-pointer text-sm font-medium">{source.officialReference} · {copy.version} {source.version} · {source.conversionDate}</summary><div className="mt-3"><CapitalReductionAnnouncementTerms announcement={source} copy={copy} /></div></details>{isFutureCapitalReductionConversion(source) ? <p className="text-sm text-amber-700">{copy.futureConversion}</p> : null}{canWrite ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => reuseAnnouncement(source)} data-testid="capital-reduction-reuse-announcement">{copy.reuseAnnouncement}</Button> : null}{data.announcementGenerations?.filter(entry => entry.accountId === activeAccountId && entry.eventId === source.eventId && entry.version === source.version).map(entry => <CapitalReductionGenerationStatus key={`${entry.accountId}:${entry.eventId}:${entry.version}`} generation={entry.generation} copy={copy} busy={busy} onRetry={canWrite ? () => void retryAnnouncement(entry) : undefined} />)}</article>)}</section> : null}
        <section className="space-y-3" data-testid="capital-reduction-timeline"><h4 className="font-semibold">{copy.timeline}</h4>{data.actions.length === 0 ? <p className="text-sm text-muted-foreground">{copy.empty}</p> : data.actions.map(action => <ActionHistory key={action.id} action={action} copy={copy} locale={locale} canWrite={canWrite} busy={busy} onBegin={begin} onRetry={() => void retry(action.id)} />)}</section>
      </>}
      {editing && canWrite ? <section className="space-y-4 border-t border-border pt-4" data-testid="capital-reduction-editor">
        <div className="flex items-center justify-between gap-2"><h4 className="text-lg font-semibold">{announcementOnly ? copy.registerAnnouncement : copy[operationLabel[operation]]}</h4><Button variant="ghost" disabled={busy} onClick={() => { setEditing(false); invalidatePreview(); }}>{copy.cancel}</Button></div>
        {activePreview ? <>
          {announcementPreview ? <CapitalReductionAnnouncementPreview preview={announcementPreview} copy={copy} accountName={eligibleAccounts.find(account => account.id === announcementPreview.input.accountId)?.name ?? announcementPreview.input.accountId} /> : preview ? <CapitalReductionPreview preview={preview} accountName={eligibleAccounts.find(account => account.id === preview.input.accountId)?.name ?? preview.input.accountId} copy={copy} locale={locale} previousAction={preview.priorAction ?? selected} /> : null}
          <p className="text-xs text-muted-foreground">{copy.expires}: {new Date(activePreview.expiresAt).toLocaleString(locale)}</p>
          {expired ? <p role="alert" className="text-sm text-destructive">{copy.expired}</p> : null}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} disabled={busy || activePreview.blockers.length > 0 || expired} data-testid="capital-reduction-accept" /><span>{announcementOnly ? copy.announcementConfirmation : copy.confirmationCheck}</span></label>
          <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={invalidatePreview}>{copy.edit}</Button><Button disabled={busy || !accepted || activePreview.blockers.length > 0 || expired} onClick={() => void confirm()} data-testid="capital-reduction-confirm">{busy ? copy.confirming : announcementOnly ? copy.confirmAnnouncement : copy.confirm}</Button></div>
        </> : <form className="space-y-5" onSubmit={event => { event.preventDefault(); void requestPreview(); }}>
          <fieldset disabled={busy} className="space-y-4">
            <legend className="font-semibold">{copy.announcement}</legend>
            {["POST", "AMEND"].includes(operation) ? <>
              <label className="grid gap-1 text-sm"><span>{copy.sourceChoice}</span><select className="h-10 rounded-md border border-input bg-background px-3" value={sourceChoice} onChange={event => chooseSource(event.target.value)} data-testid="capital-reduction-source"><option value="">{copy.manual}</option>{data.announcements.map(item => <option key={`${item.eventId}:${item.version}`} value={`${item.eventId}:${item.version}`}>{item.officialReference} · {copy.version} {item.version} · {item.conversionDate}</option>)}</select></label>
              <p className="text-sm text-muted-foreground">{copy.sourceHelp}</p>
              {sourceChoice ? <Button variant="secondary" onClick={() => { setSourceChoice(""); changeAnnouncement("version", String(Math.max(...data.announcements.filter(item => item.eventId === announcement.eventId).map(item => item.version), Number(announcement.version)) + 1)); }} data-testid="capital-reduction-new-version">{copy.newVersion}</Button> : null}
            </> : null}
            <AnnouncementFields form={announcement} copy={copy} disabled={sourceLocked} onChange={changeAnnouncement} />
          </fieldset>
          {announcementOnly ? <p className="text-sm text-muted-foreground">{copy.announcementOnlyHelp}</p> : futureConversion && operation === "POST" ? <div className="space-y-2 rounded-md border border-amber-300 p-3"><p className="text-sm text-amber-700">{copy.futureConversion}</p><Button variant="secondary" onClick={() => { invalidatePreview(); setAnnouncementOnly(true); }} data-testid="capital-reduction-prepare-announcement">{copy.prepareAnnouncement}</Button></div> : null}
          {!announcementOnly ? <fieldset disabled={busy || !["POST", "AMEND"].includes(operation)} className="space-y-3"><legend className="font-semibold">{copy.delivery}</legend><p className="text-sm text-muted-foreground">{copy.datesHelp}</p><Field label={copy.confirmedQuantity} value={confirmedQuantity} onChange={value => { invalidatePreview(); setConfirmedQuantity(value); }} name="confirmedWholeQuantity" type="number" /></fieldset> : null}
          <div className="grid gap-3 sm:grid-cols-2">{!announcementOnly ? <Field label={copy.evidence} value={evidence} onChange={value => { invalidatePreview(); setEvidence(value); }} name="evidenceReference" disabled={busy} /> : null}<Field label={copy.reason} value={reason} onChange={value => { invalidatePreview(); setReason(value); }} name="reason" disabled={busy} /></div>
          {!announcementOnly && operation !== "VOID" ? <>
            <section className="space-y-3"><h5 className="font-semibold">{copy.receipt}</h5><p className="text-sm text-muted-foreground">{copy.classificationHelp}</p>{selected ? <p className="text-sm text-muted-foreground">{copy.editHelp}</p> : null}
              {receipts.map((receipt, index) => <RepaymentFields key={receipt.id} form={receipt} index={index} copy={copy} disabled={busy || (operation === "RECONCILE" && Boolean(selected?.revisions.at(-1)?.input.repaymentReceipts.some(item => item.id === receipt.id)))} onChange={next => updateReceipt(index, next)} onRemove={() => { invalidatePreview(); setReceipts(current => current.filter(item => item.id !== receipt.id)); }} canRemove={operation === "AMEND" || !selected?.revisions.at(-1)?.input.repaymentReceipts.some(item => item.id === receipt.id)} />)}
              <Button variant="secondary" disabled={busy} onClick={() => { invalidatePreview(); setReceipts(current => [...current, { ...createRepaymentForm(), id: crypto.randomUUID() }]); }} data-testid="capital-reduction-add-receipt">{copy.addReceipt}</Button>
            </section>
            <section className="space-y-3"><h5 className="font-semibold">{copy.fractionSettlement}</h5><p className="text-sm text-muted-foreground">{copy.fractionHelp}</p>{fraction ? <FractionFields form={fraction} copy={copy} disabled={busy || (operation === "RECONCILE" && Boolean(selected?.revisions.at(-1)?.input.fractionSettlement))} onChange={next => { invalidatePreview(); setFraction(next); }} /> : <Button variant="secondary" disabled={busy} onClick={() => { invalidatePreview(); setFraction({ ...createFractionSettlementForm(), id: crypto.randomUUID() }); }} data-testid="capital-reduction-add-fraction">{copy.addFraction}</Button>}{fraction && (operation === "AMEND" || !selected?.revisions.at(-1)?.input.fractionSettlement) ? <Button variant="ghost" disabled={busy} onClick={() => { invalidatePreview(); setFraction(null); setFractionAdjustments([]); }}>{copy.cancel} · {copy.fractionSettlement}</Button> : null}</section>
            {fraction ? <section className="space-y-3" data-testid="capital-reduction-fraction-adjustments"><h5 className="font-semibold">{copy.fractionAdjustments}</h5><p className="text-sm text-muted-foreground">{copy.fractionAdjustmentHelp}</p>
              {fractionAdjustments.map((adjustment, index) => <FractionAdjustmentFields key={adjustment.id} form={adjustment} index={index} copy={copy} disabled={busy || (operation === "RECONCILE" && Boolean(selected?.revisions.at(-1)?.input.fractionAdjustments?.some(item => item.id === adjustment.id)))} onChange={next => { invalidatePreview(); setFractionAdjustments(current => current.map(item => item.id === adjustment.id ? next : item)); }} canRemove={operation === "AMEND" || !selected?.revisions.at(-1)?.input.fractionAdjustments?.some(item => item.id === adjustment.id)} onRemove={() => { invalidatePreview(); setFractionAdjustments(current => current.filter(item => item.id !== adjustment.id)); }} />)}
              <Button variant="secondary" disabled={busy} onClick={() => { invalidatePreview(); setFractionAdjustments(current => [...current, { ...createFractionAdjustmentForm(), id: crypto.randomUUID() }]); }} data-testid="capital-reduction-add-fraction-adjustment">{copy.addFractionAdjustment}</Button>
            </section> : null}
          </> : !announcementOnly ? <p className="text-sm text-amber-700">{copy.noRefund}</p> : null}
          <Button type="submit" disabled={busy || (!announcementOnly && operation === "POST" && futureConversion)} data-testid="capital-reduction-preview-button">{copy.preview}</Button>
        </form>}
      </section> : null}
    </div> : null}
  </section>;
}

function Field({ label, name, value, onChange, type = "text", disabled = false, required = true }: { label: string; name: string; value: string; onChange: (value: string) => void; type?: string; disabled?: boolean; required?: boolean }) {
  return <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{label}</span><Input type={type} inputMode={type === "number" ? "decimal" : undefined} min={type === "number" ? "0" : undefined} step={type === "number" ? "any" : undefined} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} required={required} data-testid={`capital-reduction-${name}`} /></label>;
}

function AnnouncementFields({ form, copy, disabled, onChange }: { form: AnnouncementForm; copy: CapitalReductionCopy; disabled: boolean; onChange: <Key extends keyof AnnouncementForm>(key: Key, value: AnnouncementForm[Key]) => void }) {
  const dateKeys = ["publishedDate", "reductionDate", "suspensionStartDate", "suspensionEndDate", "exchangeRecordDate", "scheduledPaymentDate"] as const;
  return <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <Field label={copy.version} name="version" type="number" value={form.version} onChange={value => onChange("version", value)} />
    <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{copy.venue}</span><select value={form.venue} onChange={event => onChange("venue", event.target.value as AnnouncementForm["venue"])} className="h-10 rounded-md border border-input bg-background px-3" data-testid="capital-reduction-venue"><option value="TWSE">TWSE</option><option value="TPEX">TPEx</option></select></label>
    <Field label={copy.reference} name="officialReference" value={form.officialReference} onChange={value => onChange("officialReference", value)} />
    <Field label={copy.sourceUrl} name="sourceUrl" type="url" value={form.sourceUrl} onChange={value => onChange("sourceUrl", value)} />
    {dateKeys.map(key => <Field key={key} label={copy[key]} name={key} type="date" value={form[key]} onChange={value => onChange(key, value)} />)}
    <Field label={copy.conversionDate} name="conversionDate" type="date" value={form.conversionDate.slice(0, 10)} onChange={value => onChange("conversionDate", `${value}T${form.conversionDate.slice(11, 16) || "00:00"}`)} />
    <Field label={copy.conversionTime} name="conversionTime" type="time" value={form.conversionDate.slice(11, 16)} onChange={value => onChange("conversionDate", `${form.conversionDate.slice(0, 10)}T${value}`)} />
    <Field label={copy.oldShares} name="ratioDenominator" value={form.ratioDenominator} onChange={value => onChange("ratioDenominator", value)} />
    <Field label={copy.newShares} name="ratioNumerator" value={form.ratioNumerator} onChange={value => onChange("ratioNumerator", value)} />
    <Field label={copy.repaymentPerOldShare} name="repaymentPerOldShare" value={form.repaymentPerOldShare} onChange={value => onChange("repaymentPerOldShare", value)} />
    <label className="grid gap-1 text-sm"><span className="text-muted-foreground">{copy.rounding}</span><select value={form.payoutRounding} onChange={event => onChange("payoutRounding", event.target.value as AnnouncementForm["payoutRounding"])} className="h-10 rounded-md border border-input bg-background px-3" data-testid="capital-reduction-rounding"><option value="FLOOR">{copy.floor}</option><option value="HALF_UP">{copy.halfUp}</option></select></label>
    <Field label={copy.referencePrice} name="officialReferencePrice" value={form.officialReferencePrice ?? ""} onChange={value => onChange("officialReferencePrice", value)} required={false} />
    <Field label={copy.fractionPrice} name="fractionReferencePrice" value={form.fractionReferencePrice ?? ""} onChange={value => onChange("fractionReferencePrice", value)} required={false} />
    <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">{copy.referenceHelp}</p>
  </fieldset>;
}

function RepaymentFields({ form, index, copy, disabled, onChange, onRemove, canRemove }: { form: RepaymentForm; index: number; copy: CapitalReductionCopy; disabled: boolean; onChange: (value: RepaymentForm) => void; onRemove: () => void; canRemove: boolean }) {
  const [classificationOnly, setClassificationOnly] = useState(false);
  return <fieldset disabled={disabled} className="space-y-3 rounded-md border border-border p-3" data-testid="capital-reduction-receipt-form"><legend className="px-1 text-sm font-medium">{copy.receipt} {index + 1}</legend>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={classificationOnly} onChange={event => { setClassificationOnly(event.target.checked); if (event.target.checked) onChange({ ...form, cashAmount: "0", feeAmount: form.grossAmount }); }} data-testid={`capital-reduction-receipt-${index}-classification`} /><span>{copy.classification}</span></label>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={copy.receivedDate} name={`receipt-${index}-receivedDate`} type="date" value={form.receivedDate} onChange={value => onChange({ ...form, receivedDate: value })} />
      <Field label={copy.evidence} name={`receipt-${index}-evidenceReference`} value={form.evidenceReference} onChange={value => onChange({ ...form, evidenceReference: value })} />
      <Field label={copy.gross} name={`receipt-${index}-grossAmount`} type="number" value={form.grossAmount} onChange={value => onChange({ ...form, grossAmount: value, ...(classificationOnly ? { feeAmount: value, cashAmount: "0" } : {}) })} />
      <Field label={copy.netCash} name={`receipt-${index}-cashAmount`} type="number" value={form.cashAmount} disabled={classificationOnly} onChange={value => onChange({ ...form, cashAmount: value })} />
      <Field label={copy.bankFee} name={`receipt-${index}-feeAmount`} type="number" value={form.feeAmount} disabled={classificationOnly} onChange={value => onChange({ ...form, feeAmount: value })} />
    </div>
    {canRemove ? <Button variant="ghost" onClick={onRemove}>{copy.removeReceipt}</Button> : null}
  </fieldset>;
}

function FractionFields({ form, copy, disabled, onChange }: { form: FractionSettlementForm; copy: CapitalReductionCopy; disabled: boolean; onChange: (value: FractionSettlementForm) => void }) {
  return <fieldset disabled={disabled} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="capital-reduction-fraction-form">
    <Field label={copy.receivedDate} name="fraction-receivedDate" type="date" value={form.receivedDate} onChange={value => onChange({ ...form, receivedDate: value })} />
    <Field label={copy.evidence} name="fraction-evidenceReference" value={form.evidenceReference} onChange={value => onChange({ ...form, evidenceReference: value })} />
    {([ ["grossAmount", "gross"], ["processingFeeAmount", "processingFee"], ["feeOffsetAmount", "feeOffset"], ["cashAmount", "netCash"], ["feeCashPaidAmount", "feeCashPaid"] ] as const).map(([key, label]) => <Field key={key} label={copy[label]} name={`fraction-${key}`} type="number" value={form[key]} onChange={value => onChange({ ...form, [key]: value })} />)}
  </fieldset>;
}

function ActionHistory({ action, copy, locale, canWrite, busy, onBegin, onRetry }: { action: AccountCapitalReductionDto; copy: CapitalReductionCopy; locale: LocaleCode; canWrite: boolean; busy: boolean; onBegin: (action: AccountCapitalReductionDto, operation: Operation) => void; onRetry: () => void }) {
  const latest = action.revisions.at(-1);
  const money = (value: number | null) => value === null ? copy.incomplete : formatCurrencyAmount(value, "TWD", locale);
  return <article className="space-y-4 rounded-lg border border-border p-4" data-testid="capital-reduction-action">
    <div className="flex flex-wrap justify-between gap-2"><div><h5 className="font-semibold">{latest?.input.announcement.conversionDate} · {latest?.input.announcement.officialReference}</h5><p className="text-xs text-muted-foreground">{copy.sourceVersion}: {latest?.input.announcement.version} · {copy.revision}: {action.revision}</p></div><div className="text-sm">{action.status === "VOIDED" ? copy.voided : copy.posted} · {action.status === "VOIDED" ? copy.noItems : action.reconciliation.reconciled ? copy.reconciled : copy.pending}</div></div>
    {latest ? <div className="space-y-1 text-sm"><a href={latest.input.announcement.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all underline">{latest.input.announcement.sourceUrl}</a><p>{copy.evidence}: {latest.input.evidenceReference}</p><p>{copy.expected}: {action.calculation.wholeQuantity} · {copy.confirmed}: {latest.input.confirmedWholeQuantity}</p></div> : null}
    {action.status !== "VOIDED" ? <>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[[copy.outstanding, money(action.reconciliation.outstandingRepaymentAmount)], [copy.cash, money(action.reconciliation.cashAmount)], [copy.fees, money(action.reconciliation.feeAmount)], [copy.fraction, action.calculation.fractionalQuantity], [copy.fractionCost, money(action.calculation.fractionalCostAmount)], [copy.estimatedFraction, action.reconciliation.fractionalStatus === "PENDING" ? money(action.calculation.estimatedFractionAmount) : action.reconciliation.fractionalStatus === "NONE" ? copy.noFraction : copy.settled], [copy.fractionResult, action.reconciliation.fractionalStatus === "PENDING" ? copy.unsettled : money(action.reconciliation.fractionalRealizedAmount)], [copy.outstandingFee, money(action.reconciliation.outstandingFractionFeeAmount)], [copy.outstandingProceeds, money(action.reconciliation.outstandingFractionProceedsAmount)], [copy.wholeCost, money(action.calculation.wholeCostAmount)]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium">{value}</dd></div>)}</dl>
      {action.reconciliation.fractionalStatus === "PENDING" ? <p className="text-xs text-amber-700">{copy.estimateHelp}</p> : null}
      <CapitalReductionValuation valuation={action.valuation} generation={action.generation} copy={copy} locale={locale} onRetry={canWrite ? onRetry : undefined} busy={busy} />
    </> : <p className="text-sm text-muted-foreground">{copy.noRefund}</p>}
    {canWrite ? <div className="flex flex-wrap gap-2">{action.status === "VOIDED" ? <Button variant="secondary" disabled={busy} onClick={() => onBegin(action, "RESTORE")} data-testid="capital-reduction-restore">{copy.restore}</Button> : <><Button variant="secondary" disabled={busy} onClick={() => onBegin(action, "RECONCILE")} data-testid="capital-reduction-reconcile">{copy.reconcile}</Button><Button variant="secondary" disabled={busy} onClick={() => onBegin(action, "AMEND")} data-testid="capital-reduction-amend">{copy.amend}</Button><Button variant="destructive" disabled={busy} onClick={() => onBegin(action, "VOID")} data-testid="capital-reduction-void">{copy.void}</Button></>}</div> : null}
    <details><summary className="cursor-pointer text-sm font-medium">{copy.history}</summary><ol className="mt-3 space-y-3">{action.revisions.map(revision => <li key={revision.revision} className="space-y-1 border-l-2 border-border pl-3 text-sm"><p>{copy.revision} {revision.revision} · {copy[operationLabel[revision.operation]]}</p><p>{copy.actor}: {revision.actorId} · {copy.confirmedAt}: {new Date(revision.confirmedAt).toLocaleString(locale)}</p><p>{copy.reason}: {revision.reason}</p><p>{copy.evidence}: {revision.input.evidenceReference}</p><p>{copy.superseded}: {revision.supersededFactIds.join(", ") || copy.noItems}</p>{revision.input.repaymentReceipts.map(receipt => <p key={receipt.id}>{copy.receipt}: {receipt.receivedDate} · {receipt.evidenceReference} · {copy.gross}: {money(receipt.grossAmount)} · {copy.netCash}: {money(receipt.cashAmount)} · {copy.bankFee}: {money(receipt.feeAmount)}</p>)}{revision.input.fractionSettlement ? <p>{copy.fractionSettlement}: {revision.input.fractionSettlement.receivedDate} · {revision.input.fractionSettlement.evidenceReference} · {copy.gross}: {money(revision.input.fractionSettlement.grossAmount)} · {copy.processingFee}: {money(revision.input.fractionSettlement.processingFeeAmount)} · {copy.feeOffset}: {money(revision.input.fractionSettlement.feeOffsetAmount)} · {copy.netCash}: {money(revision.input.fractionSettlement.cashAmount)} · {copy.feeCashPaid}: {money(revision.input.fractionSettlement.feeCashPaidAmount)}</p> : null}{revision.input.fractionAdjustments?.map(adjustment => <p key={adjustment.id}>{copy.fractionAdjustments}: {adjustment.occurredDate} · {adjustment.evidenceReference} · {copy.newProcessingFee}: {money(adjustment.processingFeeAmount)} · {copy.additionalOffset}: {money(adjustment.feeOffsetAmount)} · {copy.additionalCash}: {money(adjustment.cashAmount)} · {copy.additionalFeePaid}: {money(adjustment.feeCashPaidAmount)}</p>)}</li>)}</ol></details>
  </article>;
}

function FractionAdjustmentFields({ form, index, copy, disabled, onChange, canRemove, onRemove }: { form: FractionAdjustmentForm; index: number; copy: CapitalReductionCopy; disabled: boolean; onChange: (value: FractionAdjustmentForm) => void; canRemove: boolean; onRemove: () => void }) {
  return <fieldset disabled={disabled} className="space-y-3 rounded-md border border-border p-3" data-testid="capital-reduction-fraction-adjustment-form">
    <legend className="px-1 text-sm font-medium">{copy.fractionAdjustments} {index + 1}</legend>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={copy.occurredDate} name={`adjustment-${index}-occurredDate`} type="date" value={form.occurredDate} onChange={value => onChange({ ...form, occurredDate: value })} />
      <Field label={copy.evidence} name={`adjustment-${index}-evidenceReference`} value={form.evidenceReference} onChange={value => onChange({ ...form, evidenceReference: value })} />
      {([ ["processingFeeAmount", "newProcessingFee"], ["feeOffsetAmount", "additionalOffset"], ["cashAmount", "additionalCash"], ["feeCashPaidAmount", "additionalFeePaid"] ] as const).map(([key, label]) => <Field key={key} label={copy[label]} name={`adjustment-${index}-${key}`} type="number" value={form[key]} onChange={value => onChange({ ...form, [key]: value })} />)}
    </div>
    {canRemove ? <Button variant="ghost" onClick={onRemove}>{copy.removeFractionAdjustment}</Button> : null}
  </fieldset>;
}
