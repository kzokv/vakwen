import { generateCurrencyWalletSnapshots } from "./currencyWalletSnapshotGeneration.js";
import { consumeCapitalReductionGenerationFailure } from "./capitalReductionGenerationControl.js";
import { capitalReductionInputSchema, capitalReductionAnnouncementInputSchema } from "../validation/capitalReduction.js";
import { capitalReductionValuation, loadCapitalReductionValuations } from "./capitalReductionValuation.js";
import { createHash, randomUUID } from "node:crypto";
import { calculateCashCapitalReduction, calculateCapitalReductionSettlement, validateCashCapitalReductionTerms, roundToDecimal } from "@vakwen/domain";
import type { AccountCapitalReductionDto, CapitalReductionInputDto, CapitalReductionConfirmDto, CapitalReductionPreviewDto, CapitalReductionValuationDto, CapitalReductionAnnouncementInputDto, CapitalReductionAnnouncementPreviewDto, CapitalReductionAnnouncementDto } from "@vakwen/shared-types";
import type { Persistence } from "../persistence/types.js";
import type { Store } from "../types/store.js";
import type { CapitalReductionFacts } from "../types/capitalReduction.js";
import { routeError } from "../lib/routeError.js";
import { MemoryPersistence } from "../persistence/memory.js";
import { buildReplayLotsBeforeBoundary, replayPositionHistory } from "./replayPositionHistory.js";
import { recomputeSnapshotsForTicker } from "./snapshotGeneration.js";

export interface CapitalReductionContext {
  ownerUserId: string;
  actorId: string;
  /** Effective access is rechecked inside the writer lock, including on retries. */
  authorize: () => Promise<string>;
  publish?: (change: { accountId: string; ticker: string; actionId: string; generationStatus: string; kind: "action" | "announcement" }) => Promise<void>;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([,entry]) => entry !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([key,entry]) => [key,canonical(entry)]));
  return value;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function state(store: Store): CapitalReductionFacts {
  return store.accounting.facts.capitalReductions ??= { announcements: [], actions: [], previews: [] };
}
async function accountingDigest(persistence: Persistence, store: Store): Promise<string> {
  const facts = { ...store.accounting.facts, capitalReductions: undefined };
  const revisions = await Promise.all(store.accounts.map(async (account) => [account.id, await persistence.getAccountAccountingRevision(store.userId, account.id)]));
  return hash({ revisions, accounts: store.accounts, facts, actions: state(store).actions.map((action) => [action.id, action.revision]) });
}
function latest(action: AccountCapitalReductionDto) { return action.revisions[action.revisions.length - 1]; }
function assertScope(store: Store, input: Pick<CapitalReductionInputDto, "accountId" | "ticker" | "announcement">): void {
  const account = store.accounts.find((row) => row.id === input.accountId);
  if (!account) throw routeError(404, "account_not_found", "Account not found");
  const instrument = store.instruments.find((row) => row.ticker === input.ticker && row.marketCode === "TW");
  if (account.defaultCurrency !== "TWD" || input.announcement.currency !== "TWD" || input.announcement.marketCode !== "TW" || input.announcement.instrumentType !== "STOCK" || !["TWSE", "TPEX"].includes(input.announcement.venue) || instrument?.type !== "STOCK" || input.announcement.ticker !== input.ticker) throw routeError(400, "unsupported_capital_reduction", "Cash capital reduction supports TWSE/TPEx TWD stocks only");
}
export async function listCapitalReductions(persistence: Persistence, context: CapitalReductionContext, accountId?: string, ticker?: string) {
  await context.authorize();
  const store = await persistence.loadStore(context.ownerUserId);
  if (accountId && !store.accounts.some((account) => account.id === accountId)) throw routeError(404, "account_not_found", "Account not found");
  const valuations = await loadCapitalReductionValuations(store, persistence);
  return {
    actions: state(store).actions.filter((action) => store.accounts.some((account) => account.id === action.accountId) && (!accountId || action.accountId === accountId) && (!ticker || action.ticker === ticker)).map((action) => ({ ...action, valuation: valuations.get(action.id) ?? capitalReductionValuation(action) })),
    announcements: state(store).announcements.filter((announcement) => !ticker || announcement.ticker === ticker),
    announcementGenerations: state(store).announcementGenerations?.filter((entry) => store.accounts.some((account) => account.id===entry.accountId) && (!accountId || entry.accountId===accountId) && (!ticker || state(store).announcements.some((announcement) => announcement.eventId===entry.eventId && announcement.version===entry.version && announcement.ticker===ticker))) ?? [],
  };
}

async function prepare(persistence: Persistence, store: Store, input: CapitalReductionInputDto, actorId: string) {
  assertScope(store, input);
  const facts = state(store);
  const current = facts.actions.find((action) => action.accountId === input.accountId && action.eventId === input.announcement.eventId);
  if (input.operation === "POST" && current) throw routeError(409, "capital_reduction_exists", "Account already has this announcement history; amend or restore it");
  if (input.operation !== "POST" && (!current || current.id !== input.actionId || current.revision !== input.expectedRevision)) throw routeError(409, "capital_reduction_revision_conflict", "Action revision has changed");
  if (input.operation === "RESTORE" && current?.status !== "VOIDED") throw routeError(409, "capital_reduction_not_voided", "Only a voided history can be restored");
  if (current?.status === "VOIDED" && !["RESTORE", "VOID"].includes(input.operation)) throw routeError(409, "capital_reduction_voided", "Restore the voided history first");
  const terms = input.announcement;
  const taipeiDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (input.operation !== "VOID" && (terms.conversionDate > taipeiDate || (terms.conversionTimestamp && Date.parse(terms.conversionTimestamp) > Date.now()))) throw routeError(409,"capital_reduction_not_effective","Register announcement terms first; financial posting is available after conversion becomes effective in Taiwan");
  if ([...input.repaymentReceipts.map((receipt) => receipt.receivedDate), ...(input.fractionSettlement ? [input.fractionSettlement.receivedDate] : []), ...(input.fractionAdjustments ?? []).map((adjustment) => adjustment.occurredDate)].some((date) => date>taipeiDate)) throw routeError(409,"capital_reduction_future_settlement","Only actual settlement components on or before today in Taiwan may be confirmed");
  if (facts.announcements.some((row) => row.eventId === terms.eventId && (row.ticker !== terms.ticker || row.venue !== terms.venue))) throw routeError(409,"announcement_identity_conflict","Announcement identity belongs to another security or venue");
  const existingVersion = facts.announcements.find((row) => row.eventId === terms.eventId && row.version === terms.version);
  if (existingVersion && hash(existingVersion) !== hash(terms)) throw routeError(409, "announcement_immutable", "Published announcement version is immutable; select a new version");
  const duplicate = facts.announcements.find((row) => row.eventId !== terms.eventId && row.ticker === terms.ticker && row.venue === terms.venue && (row.officialReference === terms.officialReference || row.conversionDate === terms.conversionDate || row.exchangeRecordDate === terms.exchangeRecordDate));
  if (duplicate) throw routeError(409, "announcement_ambiguous", `Resolve the existing announcement ${duplicate.eventId} before creating another event`);
  if (current && input.operation === "RECONCILE" && (hash(terms) !== hash(latest(current).input.announcement) || input.confirmedWholeQuantity !== current.calculation.wholeQuantity)) throw routeError(400, "reconciliation_changes_conversion", "Use an amendment preview to change conversion terms");
  if (current && input.operation === "RECONCILE") {
    const priorInput = latest(current).input;
    for (const receipt of priorInput.repaymentReceipts) {
      if (!input.repaymentReceipts.some((row) => row.id === receipt.id && hash(row) === hash(receipt))) throw routeError(409, "settlement_history_changed", "Reconciliation must preserve every confirmed receipt; use an amendment to correct it");
    }
    if (priorInput.fractionSettlement && hash(priorInput.fractionSettlement) !== hash(input.fractionSettlement)) throw routeError(409, "fraction_history_changed", "Reconciliation preserves confirmed fractional settlement; add a separately dated adjustment or amend corrections");
    for (const adjustment of priorInput.fractionAdjustments ?? []) if (!input.fractionAdjustments?.some((row) => row.id === adjustment.id && hash(row) === hash(adjustment))) throw routeError(409, "fraction_history_changed", "Reconciliation preserves confirmed fractional adjustments");
  }
  const evidence = new Set([...input.repaymentReceipts.map((row) => row.evidenceReference), ...(input.fractionSettlement ? [input.fractionSettlement.evidenceReference] : []), ...(input.fractionAdjustments ?? []).map((row) => row.evidenceReference)]);
  for (const other of facts.actions) if (other.id !== current?.id && other.accountId === input.accountId) {
    for (const revision of other.revisions) {
      const linked = [...revision.input.repaymentReceipts, ...(revision.input.fractionSettlement ? [revision.input.fractionSettlement] : []), ...(revision.input.fractionAdjustments ?? [])];
      if (linked.some((row) => evidence.has(row.evidenceReference))) throw routeError(409, "duplicate_settlement_evidence", "Settlement evidence already belongs to another account action");
    }
  }
  const actionId = current?.id ?? `capital-reduction-${randomUUID()}`;
  const conversionActionId = `pa-${actionId}`;
  const draft = structuredClone(store);
  draft.accounting.facts.positionActions = draft.accounting.facts.positionActions.filter((action) => action.id !== conversionActionId);
  const trades = draft.accounting.facts.tradeEvents.filter((trade) => trade.accountId === input.accountId && trade.ticker === input.ticker && trade.marketCode === "TW");
  const actions = draft.accounting.facts.positionActions.filter((action) => action.accountId === input.accountId && action.ticker === input.ticker && action.marketCode === "TW");
  const lots = buildReplayLotsBeforeBoundary(trades, actions, { tradeDate: terms.conversionDate, tradeTimestamp: terms.conversionTimestamp ? new Date(terms.conversionTimestamp).toISOString() : undefined }).map((lot) => ({ ...lot, id: lot.id.replace(/^boundary-lot-/, "lot-") }));
  const calculation = calculateCashCapitalReduction({ lots, ...terms, confirmedWholeQuantity: input.confirmedWholeQuantity });
  const reconciliation = calculateCapitalReductionSettlement(calculation, input);
  const supersededFactIds = current ? [conversionActionId, ...latest(current).input.repaymentReceipts.map((receipt) => receipt.id), ...(latest(current).input.fractionSettlement ? [latest(current).input.fractionSettlement!.id] : []), ...(latest(current).input.fractionAdjustments ?? []).map((row) => row.id)] : [];
  if (input.operation !== "VOID") draft.accounting.facts.positionActions.push({
    id: conversionActionId, accountId: input.accountId, ticker: input.ticker, marketCode: "TW", actionType: "CASH_CAPITAL_REDUCTION", actionDate: terms.conversionDate,
    actionTimestamp: terms.conversionTimestamp ? new Date(terms.conversionTimestamp).toISOString() : undefined, bookedAt: new Date().toISOString(), quantity: calculation.wholeQuantity,
    capitalReduction: input, source: "capital_reduction", sourceReference: actionId,
  });
  draft.accounting.facts.cashLedgerEntries = draft.accounting.facts.cashLedgerEntries.filter((entry) => entry.relatedCapitalReductionId !== actionId);
  if (input.operation !== "VOID") {
    for (const receipt of input.repaymentReceipts) if (receipt.cashAmount > 0) draft.accounting.facts.cashLedgerEntries.push({
      id: `cr-cash-${actionId}-${receipt.id}`, userId: store.userId, accountId: input.accountId, entryDate: receipt.receivedDate,
      entryType: "CAPITAL_REPAYMENT_RECEIPT", amount: receipt.cashAmount, currency: "TWD", source: "capital_repayment", relatedCapitalReductionId:actionId, sourceReference:`cr-cash-${actionId}-${receipt.id}`,
    });
    const fractions = [...(input.fractionSettlement ? [{...input.fractionSettlement,occurredDate:input.fractionSettlement.receivedDate}] : []), ...(input.fractionAdjustments ?? [])];
    for (const receipt of fractions) {
      if (receipt.cashAmount>0) draft.accounting.facts.cashLedgerEntries.push({id:`cr-fraction-cash-${actionId}-${receipt.id}`,userId:store.userId,accountId:input.accountId,entryDate:receipt.occurredDate,entryType:"CAPITAL_FRACTION_RECEIPT",amount:receipt.cashAmount,currency:"TWD",source:"capital_fraction_settlement",relatedCapitalReductionId:actionId,sourceReference:`cr-fraction-cash-${actionId}-${receipt.id}`});
      if (receipt.feeCashPaidAmount>0) draft.accounting.facts.cashLedgerEntries.push({id:`cr-fraction-fee-${actionId}-${receipt.id}`,userId:store.userId,accountId:input.accountId,entryDate:receipt.occurredDate,entryType:"CAPITAL_REDUCTION_FEE_PAYMENT",amount:-receipt.feeCashPaidAmount,currency:"TWD",source:"capital_fraction_fee_payment",relatedCapitalReductionId:actionId,sourceReference:`cr-fraction-fee-${actionId}-${receipt.id}`});
    }
  }
  // Replay the complete subsequent history before committing any source or projection.
  const simulation = new MemoryPersistence({ seedCatalog: false, seedDevBypassUser: false });
  await simulation.saveStore(draft);
  await replayPositionHistory(simulation, store.userId, input.accountId, input.ticker, { marketCode: "TW" });
  const replayed = await simulation.loadStore(store.userId);
  const laterSales = replayed.accounting.facts.tradeEvents.filter((trade) => trade.accountId === input.accountId && trade.ticker === input.ticker && trade.type === "SELL" && trade.tradeDate >= terms.conversionDate).map((trade) => {
    const priorCost = store.accounting.projections.lotAllocations.filter((row) => row.tradeEventId === trade.id).reduce((sum, row) => sum + row.allocatedCostAmount, 0);
    const nextCost = replayed.accounting.projections.lotAllocations.filter((row) => row.tradeEventId === trade.id).reduce((sum, row) => sum + row.allocatedCostAmount, 0);
    return { tradeEventId: trade.id, priorCostAmount: priorCost, nextCostAmount: nextCost, differenceAmount: roundToDecimal(nextCost - priorCost, 2) };
  });
  const revision = (current?.revision ?? 0) + 1;
  const now = new Date().toISOString();
  const action: AccountCapitalReductionDto = {
    id: actionId, accountId: input.accountId, ticker: input.ticker, eventId: terms.eventId, revision, status: input.operation === "VOID" ? "VOIDED" : "POSTED",
    revisions: [...(current?.revisions ?? []), { revision, operation: input.operation, actorId, confirmedAt: now, reason: input.reason, input: structuredClone(input), calculation, reconciliation, supersededFactIds }],
    calculation, reconciliation, valuation: {} as CapitalReductionValuationDto,
    generation: { status: "stale", fromDate: current ? [terms.suspensionStartDate, terms.conversionDate, latest(current).input.announcement.suspensionStartDate, latest(current).input.announcement.conversionDate].sort()[0] : [terms.suspensionStartDate, terms.conversionDate].sort()[0], updatedAt: now, retryable: true },
  };
  action.valuation = capitalReductionValuation(action);
  const nextFacts = state(replayed);
  nextFacts.actions = [...nextFacts.actions.filter((row) => row.id !== actionId), action];
  if (!existingVersion) nextFacts.announcements.push(structuredClone(terms));
  action.valuation = (await loadCapitalReductionValuations(replayed, persistence)).get(action.id) ?? capitalReductionValuation(action);
  return { draft: replayed, action, current, lots, calculation, reconciliation, supersededFactIds, laterSales };
}

export async function previewCapitalReduction(persistence: Persistence, context: CapitalReductionContext, input: CapitalReductionInputDto): Promise<CapitalReductionPreviewDto> {
  input = capitalReductionInputSchema.parse(input);
  return persistence.withTransactionWriteLock(context.ownerUserId, async (writer) => {
    const accessDigest = await context.authorize();
    const store = structuredClone(await writer.loadStore(context.ownerUserId));
    assertScope(store, input);
    const accounting = await accountingDigest(persistence, store), previewId = randomUUID(), expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const fingerprint = hash({ actor: context.actorId, owner: context.ownerUserId, input, accounting, accessDigest, expiresAt });
    let prepared: Awaited<ReturnType<typeof prepare>> | undefined;
    const blockers: CapitalReductionPreviewDto["blockers"] = [];
    try { prepared = await prepare(persistence, store, input, context.actorId); } catch (error) { blockers.push({ code: (error as { code?: string }).code ?? "invalid_capital_reduction", message: error instanceof Error ? error.message : String(error) }); }
    const snapshotDates = new Set<string>();
    let snapshotOffset = 0;
    while (true) {
      const snapshots = await persistence.listHoldingSnapshots(context.ownerUserId, { accountIds: [input.accountId], pairs: [{ accountId: input.accountId, ticker: input.ticker, marketCode: "TW" }], startDate: prepared?.action.generation.fromDate ?? input.announcement.conversionDate, includeProvisional: true, limit: 1000, offset: snapshotOffset });
      for (const snapshot of snapshots.rows) snapshotDates.add(snapshot.snapshotDate);
      snapshotOffset += snapshots.rows.length;
      if (!snapshots.rows.length || snapshotOffset >= snapshots.total) break;
    }
    const confirmationSummary = `${input.operation} ${input.ticker} account ${input.accountId}: ${prepared?.calculation.wholeQuantity ?? input.confirmedWholeQuantity} whole shares; repayment ${prepared?.calculation.grossRepaymentAmount ?? "unavailable"} TWD; ${input.repaymentReceipts.length} receipts; ${input.reason}`;
    const preview: CapitalReductionPreviewDto = {
      previewId, fingerprint, confirmationDigest: hash({ previewId, fingerprint, confirmationSummary }), confirmationSummary, expiresAt, input,
      calculation: prepared?.calculation ?? null, reconciliation: prepared?.reconciliation ?? null, valuation: prepared?.action.valuation ?? null,
      priorAction: prepared?.current,
      eligibleLots: prepared?.lots ?? [], supersededFactIds: prepared?.supersededFactIds ?? [], laterSales: prepared?.laterSales ?? [],
      affectedSnapshotDates: [...snapshotDates].sort(),
      cashDifferenceAmount: prepared ? roundToDecimal((input.operation === "VOID" ? 0 : prepared.reconciliation.cashAmount) - (prepared.current?.reconciliation.cashAmount ?? 0), 2) : 0,
      receivableDifferenceAmount: prepared ? roundToDecimal((input.operation === "VOID" ? 0 : prepared.reconciliation.outstandingRepaymentAmount) - (prepared.current?.reconciliation.outstandingRepaymentAmount ?? 0), 2) : 0,
      warnings: prepared?.action.valuation.totalAssetValue === null ? ["Valuation is incomplete; affected totals and returns must be withheld"] : [], blockers,
    };
    state(store).previews.push({ actorId: context.actorId, accessDigest, accountingDigest: accounting, preview });
    await writer.saveCapitalReductionStore(context.ownerUserId, store);
    return preview;
  });
}
export async function confirmCapitalReduction(persistence: Persistence, context: CapitalReductionContext, confirmation: CapitalReductionConfirmDto): Promise<AccountCapitalReductionDto> {
  const result = await persistence.withTransactionWriteLock(context.ownerUserId, async (writer) => {
    const access = await context.authorize();
    const store = structuredClone(await writer.loadStore(context.ownerUserId));
    const record = state(store).previews.find((row) => row.preview.previewId === confirmation.previewId && row.actorId === context.actorId);
    if (!record) throw routeError(404, "capital_reduction_preview_not_found", "Preview not found");
    const preview = record.preview;
    if (confirmation.confirmed !== true || confirmation.fingerprint !== preview.fingerprint || confirmation.confirmationDigest !== preview.confirmationDigest || confirmation.confirmationSummary !== preview.confirmationSummary || record.accessDigest !== access) throw routeError(409, "capital_reduction_confirmation_mismatch", "Confirm the exact authorized preview");
    if (record.result) return record.result;
    if (Date.parse(preview.expiresAt) <= Date.now() || await accountingDigest(persistence, store) !== record.accountingDigest) throw routeError(409, "capital_reduction_preview_stale", "Accounting or preview expiry changed; request a new preview");
    if (preview.blockers.length) throw routeError(409, "capital_reduction_blocked", "Resolve preview blockers before confirmation");
    const prepared = await prepare(persistence, store, preview.input, context.actorId);
    state(prepared.draft).previews.find((row) => row.preview.previewId === confirmation.previewId)!.result = prepared.action;
    await writer.saveCapitalReductionStore(context.ownerUserId, prepared.draft, true);
    return prepared.action;
  });
  await context.publish?.({accountId:result.accountId,ticker:result.ticker,actionId:result.id,generationStatus:result.generation.status,kind:"action"}).catch(() => undefined);
  return result;
}
export async function retryCapitalReductionGeneration(persistence: Persistence, context: CapitalReductionContext, actionId: string, options: { generateSnapshots?: typeof recomputeSnapshotsForTicker } = {}): Promise<AccountCapitalReductionDto> {
  await persistence.withTransactionWriteLock(context.ownerUserId, async (writer) => {
    await context.authorize();
    const store = structuredClone(await writer.loadStore(context.ownerUserId));
    const action = state(store).actions.find((row) => row.id === actionId);
    if (!action || !store.accounts.some((account) => account.id === action.accountId)) throw routeError(404, "capital_reduction_not_found", "Action not found");
    action.generation = { ...action.generation, status: "queued", updatedAt: new Date().toISOString(), retryable: true };
    await writer.saveCapitalReductionStore(context.ownerUserId, store);
  });
  const result = await persistence.withTransactionWriteLock(context.ownerUserId, async (writer) => {
    await context.authorize();
    const store = structuredClone(await writer.loadStore(context.ownerUserId));
    const action = state(store).actions.find((row) => row.id === actionId);
    if (!action || !store.accounts.some((account) => account.id === action.accountId)) throw routeError(404, "capital_reduction_not_found", "Action not found");
    action.generation = { ...action.generation, status: "running", updatedAt: new Date().toISOString(), retryable: true };
    await writer.saveCapitalReductionStore(context.ownerUserId, store);
    try {
      if (consumeCapitalReductionGenerationFailure(context.ownerUserId, action.id)) throw new Error("Synthetic capital-reduction snapshot dependency failure");
      await (options.generateSnapshots ?? recomputeSnapshotsForTicker)(context.ownerUserId, action.accountId, action.ticker, action.generation.fromDate, persistence, "TW");
      await generateCurrencyWalletSnapshots(context.ownerUserId,persistence);
      action.generation = { ...action.generation, status: "current", updatedAt: new Date().toISOString(), retryable: false, error: undefined };
    } catch (error) {
      action.generation = { ...action.generation, status: "failed", updatedAt: new Date().toISOString(), retryable: true, error: error instanceof Error ? error.message : String(error) };
    }
    await writer.saveCapitalReductionStore(context.ownerUserId, store);
    return action;
  });
  await context.publish?.({accountId:result.accountId,ticker:result.ticker,actionId:result.id,generationStatus:result.generation.status,kind:"action"}).catch(() => undefined);
  return result;
}

function validateAnnouncement(store: Store, announcement: CapitalReductionAnnouncementDto): void {
  validateCashCapitalReductionTerms(announcement);
  const announcements = state(store).announcements;
  const existing = announcements.find((row) => row.eventId === announcement.eventId && row.version === announcement.version);
  if (existing && hash(existing) !== hash(announcement)) throw routeError(409,"announcement_immutable","Published announcement version is immutable");
  if (announcements.some((row) => row.eventId === announcement.eventId && (row.ticker !== announcement.ticker || row.venue !== announcement.venue))) throw routeError(409,"announcement_identity_conflict","Announcement identity belongs to another security or venue");
  const duplicate = announcements.find((row) => row.eventId !== announcement.eventId && row.ticker === announcement.ticker && row.venue === announcement.venue && (row.officialReference === announcement.officialReference || row.conversionDate === announcement.conversionDate || row.exchangeRecordDate === announcement.exchangeRecordDate));
  if (duplicate) throw routeError(409,"announcement_ambiguous",`Resolve existing announcement ${duplicate.eventId} instead of publishing another event`);
}
export async function previewCapitalReductionAnnouncement(persistence: Persistence, context: CapitalReductionContext, input: CapitalReductionAnnouncementInputDto): Promise<CapitalReductionAnnouncementPreviewDto> {
  input = capitalReductionAnnouncementInputSchema.parse(input);
  return persistence.withTransactionWriteLock(context.ownerUserId, async (writer) => {
    const accessDigest = await context.authorize();
    const store = structuredClone(await writer.loadStore(context.ownerUserId));
    assertScope(store,{ ...input, ticker: input.announcement.ticker });
    const accounting = await accountingDigest(persistence,store), previewId = randomUUID(), expiresAt = new Date(Date.now()+15*60_000).toISOString();
    const fingerprint = hash({ actor: context.actorId, owner: context.ownerUserId, input, accessDigest, accounting, expiresAt });
    const confirmationSummary = `Publish ${input.announcement.ticker} announcement ${input.announcement.eventId} version ${input.announcement.version}; source ${input.announcement.sourceUrl}; ${input.reason}`;
    const blockers: CapitalReductionAnnouncementPreviewDto["blockers"] = [];
    try { validateAnnouncement(store,input.announcement); } catch(error) { blockers.push({ code: (error as {code?:string}).code ?? "invalid_announcement", message: error instanceof Error ? error.message : String(error) }); }
    const preview: CapitalReductionAnnouncementPreviewDto = { previewId,fingerprint,confirmationDigest:hash({previewId,fingerprint,confirmationSummary}),confirmationSummary,expiresAt,input,blockers,warnings:[] };
    (state(store).announcementPreviews ??= []).push({actorId:context.actorId,accessDigest,accountingDigest:accounting,preview});
    await writer.saveCapitalReductionStore(context.ownerUserId,store);
    return preview;
  });
}
export async function confirmCapitalReductionAnnouncement(persistence: Persistence, context: CapitalReductionContext, confirmation: CapitalReductionConfirmDto): Promise<CapitalReductionAnnouncementDto> {
  return persistence.withTransactionWriteLock(context.ownerUserId, async(writer) => {
    const access = await context.authorize();
    const store = structuredClone(await writer.loadStore(context.ownerUserId));
    const record = state(store).announcementPreviews?.find((row) => row.actorId===context.actorId && row.preview.previewId===confirmation.previewId);
    if (!record) throw routeError(404,"capital_reduction_preview_not_found","Announcement preview not found");
    const preview = record.preview;
    if (confirmation.confirmed!==true || confirmation.fingerprint!==preview.fingerprint || confirmation.confirmationDigest!==preview.confirmationDigest || confirmation.confirmationSummary!==preview.confirmationSummary || record.accessDigest!==access) throw routeError(409,"capital_reduction_confirmation_mismatch","Confirm the exact announcement preview");
    if (record.result) return record.result;
    if (Date.parse(preview.expiresAt)<=Date.now() || await accountingDigest(persistence,store)!==record.accountingDigest) throw routeError(409,"capital_reduction_preview_stale","Request a new announcement preview after accounting or access changes");
    if (preview.blockers.length) throw routeError(409,"capital_reduction_blocked","Resolve announcement identity blockers before confirmation");
    assertScope(store,{...preview.input,ticker:preview.input.announcement.ticker});
    validateAnnouncement(store,preview.input.announcement);
    if (!state(store).announcements.some((row) => row.eventId===preview.input.announcement.eventId && row.version===preview.input.announcement.version)) state(store).announcements.push(structuredClone(preview.input.announcement));
    record.result = structuredClone(preview.input.announcement);
    const terms = preview.input.announcement;
    const generations = state(store).announcementGenerations ??= [];
    for (const account of store.accounts) if (store.accounting.facts.tradeEvents.some((trade) => trade.accountId===account.id && trade.ticker===terms.ticker && trade.marketCode==="TW")) {
      if (!generations.some((entry) => entry.accountId===account.id && entry.eventId===terms.eventId && entry.version===terms.version)) generations.push({accountId:account.id,eventId:terms.eventId,version:terms.version,generation:{status:"stale",fromDate:[terms.suspensionStartDate,terms.conversionDate].sort()[0],updatedAt:new Date().toISOString(),retryable:true}});
    }
    await writer.saveCapitalReductionStore(context.ownerUserId,store);
    return record.result;
  });
}

export async function retryCapitalReductionAnnouncementGeneration(persistence: Persistence, context: CapitalReductionContext, accountId: string, eventId: string, version: number) {
  const update = async (status: "queued" | "running" | "current" | "failed", execute = false) => persistence.withTransactionWriteLock(context.ownerUserId,async(writer) => {
    await context.authorize();
    const store = structuredClone(await writer.loadStore(context.ownerUserId));
    if (!store.accounts.some((account) => account.id===accountId)) throw routeError(404,"account_not_found","Account not found");
    const entry = state(store).announcementGenerations?.find((row) => row.accountId===accountId && row.eventId===eventId && row.version===version);
    const terms = state(store).announcements.find((row) => row.eventId===eventId && row.version===version);
    if (!entry || !terms) throw routeError(404,"announcement_generation_not_found","Announcement generation not found");
    entry.generation = {...entry.generation,status,updatedAt:new Date().toISOString(),retryable:status!=="current",error:undefined};
    await writer.saveCapitalReductionStore(context.ownerUserId,store);
    if (execute) {
      try {
        await recomputeSnapshotsForTicker(context.ownerUserId,accountId,terms.ticker,entry.generation.fromDate,persistence,"TW");
        entry.generation = {...entry.generation,status:"current",updatedAt:new Date().toISOString(),retryable:false};
      } catch(error) { entry.generation = {...entry.generation,status:"failed",updatedAt:new Date().toISOString(),retryable:true,error:error instanceof Error ? error.message : String(error)}; }
      await writer.saveCapitalReductionStore(context.ownerUserId,store);
    }
    return entry;
  });
  await update("queued");
  const result=await update("running",true);
  const store=await persistence.loadStore(context.ownerUserId);
  const terms=state(store).announcements.find((row)=>row.eventId===eventId && row.version===version);
  if (terms) await context.publish?.({accountId,ticker:terms.ticker,actionId:eventId,generationStatus:result.generation.status,kind:"announcement"}).catch(()=>undefined);
  return result;
}
export async function regenerateCapitalReductionAnnouncement(persistence: Persistence, context: CapitalReductionContext, announcement: CapitalReductionAnnouncementDto): Promise<void> {
  const store = await persistence.loadStore(context.ownerUserId);
  const entries = state(store).announcementGenerations?.filter((entry) => entry.eventId===announcement.eventId && entry.version===announcement.version && entry.generation.status!=="current") ?? [];
  for (const entry of entries) await retryCapitalReductionAnnouncementGeneration(persistence,context,entry.accountId,entry.eventId,entry.version);
}
