import { getJson, postJson, postNoBody } from "../../../lib/api";
import type {
  AccountDto,
  DashboardOverviewDto,
  FeeProfileBindingDto,
  FeeProfileDto,
  InstrumentOptionDto,
  InstrumentCatalogItemDto,
  MarketCode,
  PortfolioCapabilitiesDto,
  RecomputeConfirmRequestDto,
  RecomputeConfirmResponseDto,
  RecomputeFeeMode,
  RecomputePreviewDto,
  SellAvailabilityDto,
  SellAvailabilityQueryDto,
  TransactionPrimaryDto,
  TransactionHistoryItemDto,
  TransactionHistoryPageDto,
  UserSettings,
} from "@vakwen/shared-types";
import type { IntegrityIssue } from "../../dashboard/types";
import type { TransactionInput } from "../../../components/portfolio/types";

// KZO-169: market_code query param accepted by GET /instruments. `null` /
// undefined / "ALL" all map to the server's default (no filter).
export type InstrumentCatalogMarketFilter = MarketCode | "ALL" | null | undefined;

export interface TransactionInstrumentCatalogResponse {
  instruments: InstrumentCatalogItemDto[];
}

export interface PortfolioInstrumentIndexResponse {
  instruments: InstrumentOptionDto[];
}

export type PortfolioPageData = Pick<
  DashboardOverviewDto,
  "holdings" | "holdingGroups" | "dividends" | "instruments" | "fxRates" | "refreshPending"
> & {
  capabilities: PortfolioCapabilitiesDto;
  settings?: UserSettings;
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  integrityIssue: IntegrityIssue | null;
};

export interface MarketDataPriceResponse {
  close: number;
  date: string;
  source: string;
  match: "exact" | "previous";
  reason?: "weekend" | "no_bar";
}

export interface RefreshClosesResponse {
  items: Array<{
    ticker: string;
    marketCode: MarketCode;
    status: "refreshed" | "current" | "not_eligible" | "missing" | "failed" | "queued";
    barDate: string | null;
    source: string | null;
    quality: "full_bar" | "close_only" | null;
    error?: string;
  }>;
  summary: Record<RefreshClosesResponse["items"][number]["status"], number>;
}

export interface TransactionEstimateInput {
  ticker: string;
  // KZO-169: estimate route requires `marketCode` so the server can derive the
  // trade currency from the instrument (D3 / G2). Optional only for legacy
  // callers that have not yet been updated.
  marketCode?: MarketCode;
  quantity: number;
  unitPrice: number;
  type: "BUY" | "SELL";
  isDayTrade: boolean;
  accountId: string;
}

export interface TransactionEstimateResponse {
  commissionAmount: number;
  taxAmount: number;
}

export async function fetchSellAvailability(
  input: SellAvailabilityQueryDto,
  signal?: AbortSignal,
): Promise<SellAvailabilityDto> {
  const params = new URLSearchParams({
    accountId: input.accountId,
    ticker: input.ticker.trim().toUpperCase(),
    marketCode: input.marketCode,
    tradeDate: input.tradeDate,
  });
  if (input.tradeTimestamp) params.set("tradeTimestamp", input.tradeTimestamp);
  if (typeof input.bookingSequence === "number") params.set("bookingSequence", String(input.bookingSequence));
  return getJson<SellAvailabilityDto>(`/portfolio/transactions/sell-availability?${params.toString()}`, { signal });
}

export interface CorporateActionInput {
  accountId: string;
  ticker: string;
  actionType: "SPLIT" | "REVERSE_SPLIT";
  numerator: number;
  denominator: number;
  actionDate: string;
  actionTimestamp?: string;
  cashInLieuAmount?: number;
  cashInLieuCurrency?: string;
}

export async function submitTransaction(input: TransactionInput): Promise<void> {
  // KZO-169: marketCode is required by the server (D3). The form guards this
  // with a chip+ticker commit before enabling submit; if it ever reaches the
  // wire as null the API rejects with `currency_mismatch`/Zod validation.
  await postJson("/portfolio/transactions", {
    ...input,
    ticker: input.ticker.trim().toUpperCase(),
  }, {
    "idempotency-key": `web-${Date.now()}`,
  });
}

export async function fetchTransactionHistory(filters: {
  ticker?: string;
  accountId?: string;
  accountIds?: string[];
  marketCode?: MarketCode;
  limit?: number;
}): Promise<TransactionHistoryItemDto[]> {
  const params = new URLSearchParams();

  if (filters.ticker?.trim()) {
    params.set("ticker", filters.ticker.trim().toUpperCase());
  }

  if (filters.accountId) {
    params.set("accountId", filters.accountId);
  } else if (filters.accountIds && filters.accountIds.length > 0) {
    params.set("accountIds", filters.accountIds.join(","));
  }

  if (filters.marketCode) {
    params.set("marketCode", filters.marketCode);
  }

  if (filters.limit) {
    params.set("limit", String(filters.limit));
  }

  const query = params.toString();
  return getJson<TransactionHistoryItemDto[]>(query ? `/portfolio/transactions?${query}` : "/portfolio/transactions");
}

export interface TransactionHistoryPageQuery {
  type?: "BUY" | "SELL" | "ALL";
  pnl?: "any" | "realized";
  marketCode?: MarketCode | "ALL";
  accountId?: string | "ALL";
  ticker?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  sortBy?: "tradeDate" | "type" | "ticker" | "account" | "realizedPnl";
  sortOrder?: "asc" | "desc";
}

export async function fetchTransactionHistoryPage(query: TransactionHistoryPageQuery): Promise<TransactionHistoryPageDto> {
  const params = new URLSearchParams();

  if (query.type && query.type !== "ALL") params.set("type", query.type);
  if (query.pnl && query.pnl !== "any") params.set("pnl", query.pnl);
  if (query.marketCode && query.marketCode !== "ALL") params.set("marketCode", query.marketCode);
  if (query.accountId && query.accountId !== "ALL") params.set("accountId", query.accountId);
  if (query.ticker?.trim()) params.set("ticker", query.ticker.trim().toUpperCase());
  if (query.from?.trim()) params.set("from", query.from.trim());
  if (query.to?.trim()) params.set("to", query.to.trim());
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset && query.offset > 0) params.set("offset", String(query.offset));
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);

  const search = params.toString();
  return getJson<TransactionHistoryPageDto>(search ? `/transactions/history?${search}` : "/transactions/history");
}

export async function fetchTransactionsPrimaryData(): Promise<TransactionPrimaryDto> {
  return getJson<TransactionPrimaryDto>("/transactions/primary");
}

export async function fetchPortfolioPageData(): Promise<PortfolioPageData> {
  return fetchPortfolioEnrichmentData();
}

export async function fetchPortfolioPrimaryData(): Promise<PortfolioPageData> {
  return getJson<PortfolioPageData>("/portfolio/primary");
}

export async function fetchPortfolioEnrichmentData(): Promise<PortfolioPageData> {
  return getJson<PortfolioPageData>("/portfolio/enrichment");
}

export async function refreshPortfolioCloses(): Promise<RefreshClosesResponse> {
  return postNoBody<RefreshClosesResponse>("/portfolio/refresh-closes");
}

export async function fetchPortfolioInstrumentIndex(): Promise<PortfolioInstrumentIndexResponse> {
  return getJson<PortfolioInstrumentIndexResponse>("/portfolio/instrument-index");
}

// KZO-169: when `marketCode` is provided (TW/US/AU), the server filters the
// catalog to that market. Pass `"ALL"` (or omit) for the cross-market view
// used by the chip's All mode.
export async function fetchTransactionInstrumentCatalog(
  marketCode?: InstrumentCatalogMarketFilter,
): Promise<TransactionInstrumentCatalogResponse> {
  const params = new URLSearchParams();
  if (marketCode && marketCode !== "ALL") {
    params.set("market_code", marketCode);
  } else if (marketCode === "ALL") {
    params.set("market_code", "ALL");
  }
  const qs = params.toString();
  return getJson<TransactionInstrumentCatalogResponse>(qs ? `/instruments?${qs}` : "/instruments");
}

// KZO-170 S8: `marketCode` is now a required argument. The API's
// `/market-data/price` route requires `market_code` as a query param —
// the legacy `resolveMarketCode(ticker)` heuristic that returned `'TW'`
// for every ticker was deleted. Callers pass the form's account-derived
// market (`draftTransaction.marketCode`).
export async function fetchMarketDataPrice(
  ticker: string,
  date: string,
  marketCode: MarketCode,
  signal?: AbortSignal,
): Promise<MarketDataPriceResponse> {
  const query = new URLSearchParams({
    ticker: ticker.trim().toUpperCase(),
    date,
    market_code: marketCode,
  });
  return getJson<MarketDataPriceResponse>(`/market-data/price?${query.toString()}`, { signal });
}

export async function estimateTransaction(
  input: TransactionEstimateInput,
  signal?: AbortSignal,
): Promise<TransactionEstimateResponse> {
  return postJson<TransactionEstimateResponse>(
    "/portfolio/transactions/estimate",
    {
      ...input,
      ticker: input.ticker.trim().toUpperCase(),
    },
    undefined,
    { signal },
  );
}

export async function previewRecompute(mode: RecomputeFeeMode = "KEEP_RECORDED"): Promise<RecomputePreviewDto> {
  return postJson<RecomputePreviewDto>("/portfolio/recompute/preview", { mode });
}

export async function confirmRecompute(request: RecomputeConfirmRequestDto): Promise<RecomputeConfirmResponseDto> {
  return postJson<RecomputeConfirmResponseDto>("/portfolio/recompute/confirm", request);
}

export async function submitCorporateAction(input: CorporateActionInput): Promise<CorporateActionInput & { id?: string }> {
  return postJson<CorporateActionInput & { id?: string }>(
    "/corporate-actions",
    {
      ...input,
      ticker: input.ticker.trim().toUpperCase(),
    },
    { "idempotency-key": `corp-action-${input.accountId}-${input.ticker}-${input.actionDate}-${input.numerator}-${input.denominator}` },
  );
}
