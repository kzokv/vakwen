import { test } from "@vakwen/test-e2e/fixtures/appPages";
import type { Page, Route } from "@playwright/test";
import type {
  DividendReviewEnrichmentDto,
  DividendReviewPrimaryDto,
  DividendReviewRowDetailDto,
  DividendReviewRowSummaryDto,
  DividendReviewSortColumn,
} from "@vakwen/shared-types";
import { seedResolvedShareFromAdmin, seedUser, switchIdentity } from "./helpers/sharing";

const REVIEW_SORT_FIELDS: DividendReviewSortColumn[] = [
  "paymentDate",
  "ticker",
  "account",
  "nhiAmount",
  "bankFeeAmount",
  "otherDeductionAmount",
  "expectedNetAmount",
  "actualNetAmount",
  "varianceAmount",
  "reconciliationStatus",
];

function reviewRow(index: number, overrides: Partial<DividendReviewRowSummaryDto> = {}): DividendReviewRowSummaryDto {
  const amount = (index + 1) * 10;
  return {
    rowKind: "ledger",
    id: `qa-row-${String(index).padStart(2, "0")}`,
    version: 1,
    accountId: `account-${String(index % 4).padStart(2, "0")}`,
    accountName: `QA Account ${String(index % 4).padStart(2, "0")}`,
    dividendEventId: `qa-event-${index}`,
    ticker: `QA${String(index).padStart(3, "0")}`,
    tickerName: `QA Instrument ${index}`,
    marketCode: "TW",
    instrumentType: index % 2 === 0 ? "ETF" : "STOCK",
    eventType: "CASH",
    exDividendDate: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
    paymentDate: `2026-02-${String((index % 28) + 1).padStart(2, "0")}`,
    cashCurrency: "TWD",
    cashDividendPerShare: (amount + 4) / (100 + index),
    eligibleQuantity: 100 + index,
    expectedCashAmount: amount + 4,
    receivedCashAmount: amount + 2,
    expectedStockQuantity: 0,
    receivedStockQuantity: 0,
    postingStatus: "posted",
    cashReconciliationStatus: index % 4 === 0 ? "open" : index % 4 === 1 ? "matched" : index % 4 === 2 ? "explained" : "resolved",
    stockReconciliationStatus: null,
    reconciliationStatus: index % 4 === 0 ? "open" : index % 4 === 1 ? "matched" : index % 4 === 2 ? "explained" : "resolved",
    sourceCompositionStatus: index % 3 === 0 ? "unknown_pending_disclosure" : "provided",
    expectedGrossAmount: amount + 8,
    nhiAmount: index + 1,
    bankFeeAmount: index + 2,
    otherDeductionAmount: index + 3,
    expectedNetAmount: amount + 6,
    actualNetAmount: amount + 2,
    varianceAmount: index - 20,
    ...overrides,
  };
}

function sortValue(row: DividendReviewRowSummaryDto, field: DividendReviewSortColumn): string | number | null {
  if (field === "account") return row.accountName ?? row.accountId;
  return row[field as keyof DividendReviewRowSummaryDto] as string | number | null;
}

function sortedRows(rows: DividendReviewRowSummaryDto[], field: DividendReviewSortColumn, order: "asc" | "desc") {
  return [...rows].sort((left, right) => {
    const a = sortValue(left, field);
    const b = sortValue(right, field);
    const compared = a == null ? (b == null ? 0 : 1) : b == null ? -1 : typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b));
    const result = order === "asc" ? compared : -compared;
    return result || left.id.localeCompare(right.id);
  });
}

function reviewEnrichment(openCount = 7, pendingCount = 19): DividendReviewEnrichmentDto {
  return {
    aggregates: {
      totalExpectedCashAmount: { TWD: 12345 },
      totalReceivedCashAmount: { TWD: 12000 },
      openCount,
      byMonth: { "2026-01": { TWD: { expected: 12345, received: 12000 } } },
      byTicker: { QA000: { TWD: { expected: 12345, received: 12000 } } },
    },
    nhiRollup: {
      bucketAggregates: [{ sourceBucket: "DIVIDEND_INCOME", totalAmount: 5000, isNhiSubject: true }],
      nhiSubjectTotal: 5000,
      projectedPremium: 105.5,
      pendingCount,
      hasEtfEntries: true,
    },
    sourceComposition: { providedCount: 36, pendingCount },
  };
}

type PrimaryController = (route: Route, url: URL, payload: DividendReviewPrimaryDto) => Promise<void> | void;

async function installReviewHarness(page: Page, options: {
  rows?: DividendReviewRowSummaryDto[];
  primary?: PrimaryController;
  enrichment?: (route: Route, url: URL) => Promise<void> | void;
} = {}) {
  const allRows = options.rows ?? Array.from({ length: 55 }, (_, index) => reviewRow(index));
  const primaryUrls: string[] = [];
  const enrichmentUrls: string[] = [];
  await page.route(/\/portfolio\/dividends\/review\/primary(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    primaryUrls.push(url.href);
    const requestedField = url.searchParams.get("sortBy") ?? "paymentDate";
    const field: DividendReviewSortColumn = REVIEW_SORT_FIELDS.includes(requestedField as DividendReviewSortColumn)
      ? requestedField as DividendReviewSortColumn
      : "paymentDate";
    const order = url.searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
    const pageNumber = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 25);
    const sourceFiltered = url.searchParams.get("sourceComposition") === "pending"
      ? allRows.filter((row) => row.sourceCompositionStatus === "unknown_pending_disclosure")
      : allRows;
    const accountIds = url.searchParams.getAll("accountId");
    const cashStatuses = url.searchParams.getAll("cashStatus");
    const stockStatuses = url.searchParams.getAll("stockStatus");
    const filtered = sourceFiltered.filter((row) =>
      (accountIds.length === 0 || accountIds.includes(row.accountId))
      && (cashStatuses.length === 0 || cashStatuses.includes(row.cashReconciliationStatus))
      && (stockStatuses.length === 0 || (row.stockReconciliationStatus !== null && stockStatuses.includes(row.stockReconciliationStatus))),
    );
    const ordered = sortedRows(filtered, field, order);
    const payload: DividendReviewPrimaryDto = {
      reviewRows: ordered.slice((pageNumber - 1) * limit, pageNumber * limit),
      total: filtered.length,
      years: [2020, 2021, 2022, 2023, 2024, 2025, 2026],
      accounts: Array.from(
        new Map(allRows.map((row) => [row.accountId, { id: row.accountId, name: row.accountName ?? row.accountId }])).values(),
      ),
      eligibleTickers: Array.from(
        new Map(allRows.map((row) => [row.ticker, { ticker: row.ticker, name: row.tickerName ?? null }])).values(),
      ),
    };
    if (options.primary) await options.primary(route, url, payload);
    else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.route(/\/portfolio\/dividends\/review\/enrichment(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    enrichmentUrls.push(url.href);
    if (options.enrichment) await options.enrichment(route, url);
    else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reviewEnrichment()) });
  });
  return { allRows, primaryUrls, enrichmentUrls };
}

async function openHarnessedReview(page: Page, navigate: () => Promise<void>) {
  await navigate();
  await page.getByTestId("dividend-review-page").waitFor({ state: "visible" });
  await page.getByTestId("review-table").waitFor({ state: "visible" });
}

/**
 * Generates an ISO date string relative to the current month.
 * @param day Day of month (1-28 recommended to avoid overflow)
 * @param monthOffset 0 = current month, -1 = last month, etc.
 */
function isoDateForMonth(day: number, monthOffset = 0): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day))
    .toISOString()
    .slice(0, 10);
}

/** Returns YYYY-01-01 of the current year */
function yearStart(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}

// ─── Group 1: Filter auto-apply ─────────────────────────────────────────────

test.describe("dividend review — filter auto-apply", () => {
  test("dividends review: retired sort and repeated filters → canonical URL and OR-within/AND-across rows", async ({
    dividendReview,
    page,
  }) => {
    const rows = [
      reviewRow(0, { id: "filter-row-a", accountId: "account-00", cashReconciliationStatus: "open", stockReconciliationStatus: "matched" }),
      reviewRow(1, { id: "filter-row-b", accountId: "account-01", cashReconciliationStatus: "matched", stockReconciliationStatus: "variance" }),
      reviewRow(2, { id: "filter-row-c", accountId: "account-02", cashReconciliationStatus: "open", stockReconciliationStatus: "matched" }),
      reviewRow(3, { id: "filter-row-d", accountId: "account-01", cashReconciliationStatus: "explained", stockReconciliationStatus: "matched" }),
    ];
    const harness = await installReviewHarness(page, { rows });

    await openHarnessedReview(page, () => dividendReview.actions.navigateToReviewWithParams(
      "sortBy=exDate&accountId=account-00&accountId=account-00&accountId=account-01&cashStatus=open&cashStatus=matched&stockStatus=matched&stockStatus=variance",
    ));

    const canonicalUrl = new URL(page.url());
    dividendReview.assert.valueEquals(canonicalUrl.searchParams.getAll("accountId"), ["account-00", "account-01"]);
    dividendReview.assert.valueEquals(canonicalUrl.searchParams.getAll("cashStatus"), ["open", "matched"]);
    dividendReview.assert.valueEquals(canonicalUrl.searchParams.getAll("stockStatus"), ["matched", "variance"]);
    await dividendReview.assert.orderedRowIdsAre(["filter-row-b", "filter-row-a"]);

    await dividendReview.actions.openAccountFilter();
    await dividendReview.assert.accountFilterIsOpen();
    await dividendReview.assert.accountOptionIsChecked("account-00");
    await dividendReview.assert.accountOptionIsChecked("account-01");
    await dividendReview.actions.openCashStatusFilter();
    await dividendReview.assert.cashStatusOptionIsChecked("open");
    await dividendReview.assert.cashStatusOptionIsChecked("matched");
    await dividendReview.actions.openStockStatusFilter();
    await dividendReview.assert.stockStatusOptionIsChecked("matched");
    await dividendReview.assert.stockStatusOptionIsChecked("variance");

    await dividendReview.actions.toggleStockStatus("variance");
    await dividendReview.assert.orderedRowIdsAre(["filter-row-a"]);
    dividendReview.assert.valueContains(harness.primaryUrls.at(-1), "stockStatus=matched");
    await dividendReview.assert.urlDoesNotContain("sortBy=exDate");
  });

  test("dividends review: consolidated desktop dividend columns → labeled values replace retired amount columns", async ({
    dividendReview,
    page,
  }) => {
    const mixed = reviewRow(0, {
      id: "consolidated-row",
      eventType: "CASH_AND_STOCK",
      stockReconciliationStatus: "variance",
      expectedStockQuantity: 10,
      receivedStockQuantity: 8,
    });
    await installReviewHarness(page, { rows: [mixed] });
    await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
    await page.getByTestId("review-sort-ticker").click();

    const header = page.getByTestId("review-table").locator("thead");
    await dividendReview.assert.locatorContains(header, /Cash dividend/);
    await dividendReview.assert.locatorContains(header, /Stock dividend/);
    await dividendReview.assert.locatorContains(page.getByTestId("review-row-consolidated-row"), /per share|Expected|Received|Variance/);
    await dividendReview.assert.locatorHasCount(page.getByTestId("review-sort-expected-cash-amount"), 0);
    await dividendReview.assert.locatorHasCount(page.getByTestId("review-sort-received-cash-amount"), 0);
  });

  test("account checkbox filter: keyboard toggles stay open and announced → All resets selection", async ({
    dividendReview,
    page,
  }) => {
    await installReviewHarness(page, {
      rows: [
        reviewRow(0, { accountId: "account-00", accountName: "QA Account 00" }),
        reviewRow(1, { accountId: "account-01", accountName: "QA Account 01" }),
      ],
    });
    await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
    await dividendReview.actions.clickColumnHeader("ticker");

    await dividendReview.actions.openAccountFilterWithKeyboard();
    await dividendReview.assert.accountFilterIsOpen();
    await dividendReview.assert.accountSummaryIsExpanded();
    await dividendReview.assert.accountSummaryIsFocused();

    await dividendReview.actions.toggleAccountWithKeyboard("account-00");
    await dividendReview.assert.accountFilterIsOpen();
    await dividendReview.assert.accountOptionIsFocused("account-00");
    await dividendReview.assert.accountAnnouncementContains(/Account: QA Account 00/);

    await dividendReview.actions.toggleAccountWithKeyboard("account-01");
    await dividendReview.assert.accountFilterIsOpen();
    await dividendReview.assert.accountOptionIsFocused("account-01");
    await dividendReview.assert.accountAnnouncementContains(/Account: 2 selected/);

    await dividendReview.actions.selectAllAccountsWithKeyboard();
    await dividendReview.assert.accountFilterIsOpen();
    await dividendReview.assert.accountAllIsCheckedAndFocused();
    await dividendReview.assert.accountOptionIsUnchecked("account-00");
    await dividendReview.assert.accountOptionIsUnchecked("account-01");
    await dividendReview.assert.accountAnnouncementContains(/Account: All accounts/);
  });

  test("year range dropdown: 2010 through current year → URL and date inputs reflect range", async ({
    dividendReview,
  }) => {
    const currentYear = new Date().getUTCFullYear();
    await dividendReview.arrange.seedExpectedDividend({
      ticker: "2330",
      tradeDate: "2010-01-05",
      exDividendDate: `${currentYear}-01-10`,
      paymentDate: `${currentYear}-01-20`,
      cashDividendPerShare: 0.12,
    });

    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    const response = await dividendReview.actions.selectYearRange(2010, currentYear);

    await dividendReview.assert.responseStatusIs(response, 200);
    await dividendReview.assert.responseUrlContains(response, "fromPaymentDate=2010-01-01");
    await dividendReview.assert.responseUrlContains(response, `toPaymentDate=${currentYear}-12-31`);
    await dividendReview.assert.urlContains("preset=yearRange");
    await dividendReview.assert.urlContains("fromPaymentDate=2010-01-01");
    await dividendReview.assert.urlContains(`toPaymentDate=${currentYear}-12-31`);
    await dividendReview.assert.dateFromHasValue("2010-01-01");
    await dividendReview.assert.dateToHasValue(`${currentYear}-12-31`);
    await dividendReview.assert.yearRangeTriggerContains(`2010-${currentYear}`);
    await dividendReview.assert.yearOptionIsChecked(2010);
    await dividendReview.assert.yearOptionIsChecked(currentYear);
    await dividendReview.assert.allRowsContainText(/2330/);
  });

  test("review row display name: table and drawer show ticker plus instrument display name", async ({
    dividendReview,
    settings,
  }) => {
    await settings.arrange.seedInstruments([{
      ticker: "2330",
      name: "台積電",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    }]);
    const seeded = await dividendReview.arrange.seedExpectedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1),
      paymentDate: isoDateForMonth(15),
      cashDividendPerShare: 0.12,
    });

    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();

    await dividendReview.assert.rowContainsText(seeded.expectedReviewRowId, /2330/);
    await dividendReview.assert.rowContainsText(seeded.expectedReviewRowId, /台積電/);
    await dividendReview.actions.clickRow(seeded.expectedReviewRowId);
    await dividendReview.assert.drawerIsVisible();
    await dividendReview.assert.drawerContains(/2330/);
    await dividendReview.assert.drawerContains(/台積電/);
  });

  test("preset click: Last 7 Days → URL updates, table re-fetches, date inputs show resolved range", async ({
    dividendReview,
  }) => {
    // ARRANGE: seed dividends across different date ranges
    const today = new Date();
    const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
    const threeDaysAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 3));
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: threeDaysAgo.toISOString().slice(0, 10),
      paymentDate: yesterday.toISOString().slice(0, 10), // within last 7 days
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(1, -6),
      paymentDate: isoDateForMonth(15, -6), // 6 months ago
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickPreset("last-7-days");

    // ASSERT
    await dividendReview.assert.urlContains("fromPaymentDate");
    await dividendReview.assert.urlContains("toPaymentDate");
    await dividendReview.assert.presetIsActive("last-7-days");
    // Date inputs should be populated with the resolved range (read-only)
    // Table should filter — only recent dividend visible
    await dividendReview.assert.tableHasAtLeastRows(1);
  });

  test("custom date range: enter both dates → blur triggers fetch with correct params", async ({
    dividendReview,
  }) => {
    // ARRANGE
    const janDate = `${new Date().getUTCFullYear()}-01-15`;
    const marDate = `${new Date().getUTCFullYear()}-03-20`;
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: `${new Date().getUTCFullYear()}-01-10`,
      paymentDate: janDate,
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: `${new Date().getUTCFullYear()}-03-15`,
      paymentDate: marDate,
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickPreset("custom");
    await dividendReview.actions.fillDateTo(`${new Date().getUTCFullYear()}-01-31`);
    await dividendReview.actions.fillDateFrom(`${new Date().getUTCFullYear()}-01-01`);
    await dividendReview.actions.blurDateInputs();

    // ASSERT
    await dividendReview.assert.urlContains(`fromPaymentDate=${new Date().getUTCFullYear()}-01-01`);
    await dividendReview.assert.urlContains(`toPaymentDate=${new Date().getUTCFullYear()}-01-31`);
    await dividendReview.assert.presetIsActive("custom");
    await dividendReview.assert.tableHasAtLeastRows(1);
    await dividendReview.assert.allRowsContainText(/2330/);
  });

  test("partial custom range: clear 'to' date → inline error visible, table holds last state", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1),
      paymentDate: isoDateForMonth(10),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickPreset("custom");
    await dividendReview.actions.clearDateTo();
    await dividendReview.actions.fillDateFrom(yearStart());
    await dividendReview.actions.blurDateInputs();

    // ASSERT
    await dividendReview.assert.dateErrorIsVisible();
    // Table should still show rows from previous valid state
    await dividendReview.assert.tableHasAtLeastRows(1);
  });

  test("ticker filter: type ticker → press Enter → filtered results", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(3),
      paymentDate: isoDateForMonth(15),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(4),
      paymentDate: isoDateForMonth(16),
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.fillTicker("2330");
    await dividendReview.actions.submitTickerFilter();

    // ASSERT
    await dividendReview.assert.urlContains("ticker=2330");
    await dividendReview.assert.allRowsContainText(/2330/);
    await dividendReview.assert.noRowContainsText(/0050/);
  });

  test("status dropdown: change selection → immediate re-fetch", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "2330",
      exDividendDate: isoDateForMonth(5),
      paymentDate: isoDateForMonth(17),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      reconciliationStatus: "open",
    });
    await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "0050",
      exDividendDate: isoDateForMonth(6),
      paymentDate: isoDateForMonth(18),
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
      reconciliationStatus: "matched",
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.openCashStatusFilter();
    await dividendReview.actions.toggleCashStatus("open");

    // ASSERT
    await dividendReview.assert.urlContains("cashStatus=open");
    await dividendReview.assert.tableHasAtLeastRows(1);
  });
});

// ─── Group 2: Chart interactions ────────────────────────────────────────────

test.describe("dividend review — chart interactions", () => {
  test("accumulated tab: click → area chart renders, no bar chart", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1, -2),
      paymentDate: isoDateForMonth(15, -2),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1, -1),
      paymentDate: isoDateForMonth(15, -1),
      cashDividendPerShare: 0.15,
      receivedCashAmount: 135,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1),
      paymentDate: isoDateForMonth(15),
      cashDividendPerShare: 0.1,
      receivedCashAmount: 90,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickChartTab("accumulated");

    // ASSERT
    await dividendReview.assert.chartContainerIsVisible();
    await dividendReview.assert.chartHasAreaSeries();
    await dividendReview.assert.chartHasNoBarSeries();
  });

  test("by ticker tab: click → grouped bar chart renders", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1),
      paymentDate: isoDateForMonth(15),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(2),
      paymentDate: isoDateForMonth(16),
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickChartTab("byTicker");

    // ASSERT
    await dividendReview.assert.chartContainerIsVisible();
    await dividendReview.assert.chartHasBarSeries();
  });

  test("granularity toggle: Month → Quarter → no network request fired", async ({
    dividendReview, page,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1, -2),
      paymentDate: isoDateForMonth(15, -2),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1, -1),
      paymentDate: isoDateForMonth(15, -1),
      cashDividendPerShare: 0.15,
      receivedCashAmount: 135,
    });

    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.assert.chartContainerIsVisible();

    // ACT: capture network requests after page is stable, then toggle granularity
    const ledgerRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/portfolio/dividends/review") && req.method() === "GET") {
        ledgerRequests.push(req.url());
      }
    });

    const requestCountBefore = ledgerRequests.length;
    await dividendReview.actions.clickGranularity("quarter");

    // Wait for the granularity UI to settle, then verify no new requests
    await dividendReview.assert.granularityIsActive("quarter");
    await dividendReview.assert.chartContainerIsVisible();

    // ASSERT: no new ledger requests after granularity change
    await dividendReview.assert.noLedgerRequestsFired(ledgerRequests, requestCountBefore);
  });

  test("unspecified preset: both time-series charts default to Year granularity", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1, -3),
      paymentDate: isoDateForMonth(15, -3),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickPreset("unspecified");

    // ASSERT: Monthly tab defaults to Year granularity
    await dividendReview.assert.granularityIsActive("year");
    await dividendReview.assert.urlDoesNotContain("fromPaymentDate");
    await dividendReview.assert.urlDoesNotContain("toPaymentDate");

    // Switch to Accumulated tab — also defaults to Year
    await dividendReview.actions.clickChartTab("accumulated");
    await dividendReview.assert.granularityIsActive("year");
  });
});

// ─── Group 3: Table interactions ────────────────────────────────────────────

test.describe("dividend review — table interactions", () => {
  test("sort column: click Ticker header → correct params, page resets to 1", async ({
    dividendReview, page,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1),
      paymentDate: isoDateForMonth(10),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(2),
      paymentDate: isoDateForMonth(11),
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(3),
      paymentDate: isoDateForMonth(12),
      cashDividendPerShare: 0.3,
      receivedCashAmount: 270,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();

    // Intercept the next ledger request on sort click
    const sortRequestPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET"
        && response.url().includes("/portfolio/dividends/review")
        && response.url().includes("sortBy=ticker"),
    );

    await dividendReview.actions.clickColumnHeader("ticker");
    const sortResponse = await sortRequestPromise;

    // ASSERT
    await dividendReview.assert.responseUrlContains(sortResponse, "sortBy=ticker");
    await dividendReview.assert.responseUrlContains(sortResponse, "sortOrder=asc");
    await dividendReview.assert.responseUrlMatches(sortResponse, /page=1/);
    await dividendReview.assert.urlContains("sortBy=ticker");
    await dividendReview.assert.sortIndicatorOnColumn("ticker");
  });

  test("pagination: navigate to page 2 → different rows render", async ({
    dividendReview,
  }) => {
    // ARRANGE: seed 26 dividends to exceed PAGE_SIZE (25)
    for (let i = 0; i < 26; i++) {
      await dividendReview.arrange.seedPostedDividend({
        ticker: i % 2 === 0 ? "2330" : "0050",
        exDividendDate: isoDateForMonth(Math.max(1, (i % 28) + 1)),
        paymentDate: isoDateForMonth(Math.max(1, (i % 28) + 1)),
        cashDividendPerShare: 0.1 + i * 0.01,
        receivedCashAmount: 100 + i * 10,
      });
    }

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.assert.tableHasAtLeastRows(1);

    await dividendReview.actions.clickNextPage();

    // ASSERT
    await dividendReview.assert.urlContains("page=2");
    await dividendReview.assert.pageInfoContains(/2/);
    await dividendReview.assert.tableHasAtLeastRows(1);
  });

  test("[review reconciliation mutation]: mark a row matched → primary and enrichment invalidate without remount", async ({
    dividendReview, page,
  }) => {
    // ARRANGE
    const seeded = await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "2330",
      exDividendDate: isoDateForMonth(7),
      paymentDate: isoDateForMonth(20),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      reconciliationStatus: "open",
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.assert.markMatchedButtonIsVisible(seeded.dividendLedgerEntryId);
    const root = page.getByTestId("dividend-review-page");
    await root.evaluate((element) => element.setAttribute("data-qa-root-sentinel", "reconcile"));
    const primaryRefresh = page.waitForResponse((response) => response.url().includes("/portfolio/dividends/review/primary"));
    const enrichmentRefresh = page.waitForResponse((response) => response.url().includes("/portfolio/dividends/review/enrichment"));

    const patchResponse = await dividendReview.actions.clickMarkMatched(seeded.dividendLedgerEntryId);
    await primaryRefresh;
    await enrichmentRefresh;

    // ASSERT
    await dividendReview.assert.responseStatusIs(patchResponse, 200);
    await dividendReview.assert.markMatchedButtonIsHidden(seeded.dividendLedgerEntryId);
    // Accept both intermediate and final states per playwright-fast-sse-assertions.md
    await dividendReview.assert.rowStatusContains(
      seeded.dividendLedgerEntryId,
      /Matched|相符|Pending review|待覆核/,
    );
    await dividendReview.assert.locatorHasAttribute(root, "data-qa-root-sentinel", "reconcile");
  });

  test("row click: opens drawer with correct ticker and account", async ({
    dividendReview,
  }) => {
    // ARRANGE
    const seeded = await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(8),
      paymentDate: isoDateForMonth(22),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickRow(seeded.dividendLedgerEntryId);

    // ASSERT
    await dividendReview.assert.drawerIsVisible();
    await dividendReview.assert.drawerContains(/2330/);
  });

  test("expected row: opens posting drawer and does not expose Mark matched", async ({
    dividendReview,
  }) => {
    // ARRANGE
    const seeded = await dividendReview.arrange.seedExpectedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(12),
      paymentDate: isoDateForMonth(26),
      cashDividendPerShare: 0.2,
      eligibleQuantity: 1_000,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();

    // ASSERT
    await dividendReview.assert.rowContainsText(seeded.expectedReviewRowId, /2330/);
    await dividendReview.assert.markMatchedButtonIsHidden(seeded.expectedReviewRowId);

    await dividendReview.actions.clickRow(seeded.expectedReviewRowId);
    await dividendReview.assert.drawerIsVisible();
    await dividendReview.assert.drawerContains(/2330/);
  });
});

// ─── Group 4: Deep link ─────────────────────────────────────────────────────

test.describe("dividend review — deep link", () => {
  test("URL params hydrate filter bar and table state", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "2330",
      exDividendDate: isoDateForMonth(9),
      paymentDate: isoDateForMonth(23),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      reconciliationStatus: "open",
    });
    await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "0050",
      exDividendDate: isoDateForMonth(10),
      paymentDate: isoDateForMonth(24),
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
      reconciliationStatus: "matched",
    });

    // ACT: navigate directly with deep-link params
    await dividendReview.actions.navigateToReviewWithParams(
      "sortBy=ticker&sortOrder=asc&status=open",
    );

    // ASSERT
    await dividendReview.assert.pageLoaded();
    await dividendReview.assert.tableHasAtLeastRows(1);
    await dividendReview.assert.sortIndicatorOnColumn("ticker");
    // Only open-status rows should be visible
    await dividendReview.assert.allRowsContainText(/2330/);
  });
});

// ─── Group 5: SSE ───────────────────────────────────────────────────────────

test.describe("dividend review — SSE", () => {
  test("[review SSE desktop]: receive a dividend event while Review is open → primary and enrichment silently refresh", async ({
    dividendReview, page,
  }) => {
    // ARRANGE
    const seeded = await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "2330",
      exDividendDate: isoDateForMonth(11),
      paymentDate: isoDateForMonth(25),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      reconciliationStatus: "open",
    });

    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.assert.tableHasAtLeastRows(1);

    const root = page.getByTestId("dividend-review-page");
    await root.evaluate((element) => element.setAttribute("data-qa-root-sentinel", "stable"));
    const primaryResponse = page.waitForResponse((response) => response.url().includes("/portfolio/dividends/review/primary"));
    const enrichmentResponse = page.waitForResponse((response) => response.url().includes("/portfolio/dividends/review/enrichment"));

    // ACT: trigger reconciliation change via direct API PATCH
    await dividendReview.arrange.patchReconciliationViaApi(
      seeded.dividendLedgerEntryId,
      "matched",
    );

    await primaryResponse;
    await enrichmentResponse;

    // ASSERT: row updates in-place via SSE — accept both intermediate and final states
    await dividendReview.assert.rowStatusContains(
      seeded.dividendLedgerEntryId,
      /Matched|相符|Pending review|待覆核/,
    );

    await dividendReview.assert.locatorHasAttribute(root, "data-qa-root-sentinel", "stable");
    await dividendReview.assert.navigationCountIs(1);
  });

  test("[review SSE mobile]: receive a dividend event while Review is open → primary and enrichment silently refresh", async ({
    dividendReview, page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const seeded = await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "0050",
      exDividendDate: isoDateForMonth(10),
      paymentDate: isoDateForMonth(24),
      cashDividendPerShare: 0.4,
      receivedCashAmount: 360,
      reconciliationStatus: "open",
    });
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    const root = page.getByTestId("dividend-review-page");
    await root.evaluate((element) => element.setAttribute("data-qa-root-sentinel", "sse-mobile"));
    const primaryResponse = page.waitForResponse((response) => response.url().includes("/portfolio/dividends/review/primary"));
    const enrichmentResponse = page.waitForResponse((response) => response.url().includes("/portfolio/dividends/review/enrichment"));
    await dividendReview.arrange.patchReconciliationViaApi(seeded.dividendLedgerEntryId, "matched");
    await primaryResponse;
    await enrichmentResponse;
    await dividendReview.assert.locatorHasAttribute(root, "data-qa-root-sentinel", "sse-mobile");
    await dividendReview.assert.navigationCountIs(1);
    await dividendReview.assert.viewportHasNoHorizontalOverflow();
  });
});

// ─── Group 6: Navigation ───────────────────────────────────────────────────

test.describe("dividend review — navigation", () => {
  test("calendar page: click 'View all dividends' → switches to ledger tab on /dividends", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(12),
      paymentDate: isoDateForMonth(26),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });

    // ACT: navigate to calendar (default tab), then click the link
    await dividendReview.actions.navigateToCalendar();
    await dividendReview.actions.clickViewAllDividendsLink();

    // ASSERT — Phase 5a — /dividends/review was merged into /dividends?view=ledger.
    await dividendReview.assert.urlPathIs("/dividends");
    await dividendReview.assert.pageLoaded();
  });
});

// ─── Locked performance/state-integrity scope ─────────────────────────────

test.describe("dividend review — dedicated primary query integrity", () => {
  for (const field of REVIEW_SORT_FIELDS) {
    test(`[review sort desktop ${field}]: click inactive header twice → complete rows sort ascending then descending`, async ({
      dividendReview,
      page,
    }) => {
      const harness = await installReviewHarness(page);
      await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());

      await dividendReview.actions.clickColumnHeader(field);
      if (field === "paymentDate") await dividendReview.assert.urlDoesNotContain("sortBy");
      else await dividendReview.assert.urlContains(`sortBy=${field}`);
      await dividendReview.assert.urlContains("sortOrder=asc");
      await dividendReview.assert.orderedRowIdsAre(
        sortedRows(harness.allRows, field, "asc").slice(0, 10).map((row) => row.id),
      );
      await dividendReview.assert.sortDirectionIs(field, "ascending");

      // The default paymentDate/desc identity is preloaded by SSR. The deterministic
      // browser harness cannot intercept that server request, so use a fresh page-size
      // identity before validating the descending browser request and row order.
      if (field === "paymentDate") await dividendReview.actions.selectPageSize(25);
      await dividendReview.actions.clickColumnHeader(field);
      if (field === "paymentDate") await dividendReview.assert.urlDoesNotContain("sortBy");
      else await dividendReview.assert.urlContains(`sortBy=${field}`);
      await dividendReview.assert.urlDoesNotContain("sortOrder");
      await dividendReview.assert.orderedRowIdsAre(
        sortedRows(harness.allRows, field, "desc").slice(0, field === "paymentDate" ? 25 : 10).map((row) => row.id),
      );
      await dividendReview.assert.sortDirectionIs(field, "descending");
      dividendReview.assert.valueContains(harness.primaryUrls.at(-1), `sortBy=${field}`);
      dividendReview.assert.valueContains(harness.primaryUrls.at(-1), "sortOrder=desc");
      dividendReview.assert.valueContains(harness.primaryUrls.at(-1), "page=1");
    });

    test(`[review sort mobile ${field}]: choose field and both directions → complete cards follow URL-backed server order`, async ({
      dividendReview,
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const harness = await installReviewHarness(page);
      await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
      await dividendReview.assert.locatorIsVisible(page.getByTestId("review-mobile-sort-controls"));

      await dividendReview.actions.selectMobileSortField(field);
      await dividendReview.actions.selectMobileSortDirection("asc");
      await dividendReview.assert.orderedRowIdsAre(
        sortedRows(harness.allRows, field, "asc").slice(0, 10).map((row) => row.id),
      );
      if (field === "paymentDate") await dividendReview.assert.urlDoesNotContain("sortBy");
      else await dividendReview.assert.urlContains(`sortBy=${field}`);
      await dividendReview.assert.urlContains("sortOrder=asc");

      if (field === "paymentDate") await dividendReview.actions.selectPageSize(25);
      await dividendReview.actions.selectMobileSortDirection("desc");
      await dividendReview.assert.orderedRowIdsAre(
        sortedRows(harness.allRows, field, "desc").slice(0, field === "paymentDate" ? 25 : 10).map((row) => row.id),
      );
      await dividendReview.assert.urlDoesNotContain("sortOrder");
      dividendReview.assert.valueIsTrue(harness.primaryUrls.some((url) => url.includes(`sortBy=${field}`) && url.includes("sortOrder=desc")));
      await dividendReview.assert.viewportHasNoHorizontalOverflow();
    });
  }

  test("[review pagination desktop]: move 1 to 2 to 1 → row identities change then restore exactly", async ({
    dividendReview,
    page,
  }) => {
    const harness = await installReviewHarness(page);
    await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
    await dividendReview.actions.clickColumnHeader("ticker");
    const pageOne = sortedRows(harness.allRows, "ticker", "asc").slice(0, 10).map((row) => row.id);
    await dividendReview.assert.orderedRowIdsAre(pageOne);

    await dividendReview.actions.clickNextPage();
    const pageTwo = sortedRows(harness.allRows, "ticker", "asc").slice(10, 20).map((row) => row.id);
    await dividendReview.assert.orderedRowIdsAre(pageTwo);
    await dividendReview.assert.valueDoesNotEqual(pageTwo, pageOne);
    await dividendReview.assert.urlContains("page=2");

    await dividendReview.actions.clickPreviousPage();
    await dividendReview.assert.orderedRowIdsAre(pageOne);
    await dividendReview.assert.urlContains("page=1");
  });

  test("[review pagination mobile]: move 1 to 2 to 1 → card identities change then restore exactly", async ({
    dividendReview,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const harness = await installReviewHarness(page);
    await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
    await dividendReview.actions.selectMobileSortField("ticker");
    await dividendReview.actions.selectMobileSortDirection("asc");
    const pageOne = sortedRows(harness.allRows, "ticker", "asc").slice(0, 10).map((row) => row.id);
    await dividendReview.assert.orderedRowIdsAre(pageOne);
    await dividendReview.actions.clickNextPage();
    await dividendReview.assert.orderedRowIdsAre(
      sortedRows(harness.allRows, "ticker", "asc").slice(10, 20).map((row) => row.id),
    );
    await dividendReview.actions.clickPreviousPage();
    await dividendReview.assert.orderedRowIdsAre(pageOne);
    await dividendReview.assert.viewportHasNoHorizontalOverflow();
  });

  for (const mobile of [false, true]) {
    test(`[review page size ${mobile ? "mobile" : "desktop"}]: select 10 then 25 then 50 → row count and page reset match each request`, async ({
      dividendReview,
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await installReviewHarness(page);
      await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
      if (mobile) {
        await dividendReview.actions.selectMobileSortField("ticker");
        await dividendReview.actions.selectMobileSortDirection("asc");
      } else await dividendReview.actions.clickColumnHeader("ticker");
      for (const limit of [10, 25, 50] as const) {
        await dividendReview.actions.selectPageSize(limit);
        await dividendReview.assert.tableRowCount(limit);
        await dividendReview.assert.urlContains("page=1");
        if (limit === 10) await dividendReview.assert.urlDoesNotContain("limit");
        else await dividendReview.assert.urlContains(`limit=${limit}`);
      }
      if (mobile) await dividendReview.assert.viewportHasNoHorizontalOverflow();
    });
  }
});

test.describe("dividend review — request lifecycle and isolation", () => {
  for (const mobile of [false, true]) {
    test(`[review request lifecycle ${mobile ? "mobile" : "desktop"}]: rapidly choose two sort fields → only the final identity commits`, async ({
      dividendReview,
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      let releaseFirst: (() => void) | undefined;
      const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
      let held = false;
      const harness = await installReviewHarness(page, {
        primary: async (route, url, payload) => {
          if (!held && url.searchParams.get("sortBy") === "ticker") {
            held = true;
            await firstGate;
          }
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
        },
      });
      await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());

      if (mobile) {
        await dividendReview.actions.selectMobileSortField("ticker");
        await dividendReview.actions.selectMobileSortField("account");
      } else {
        await dividendReview.actions.clickColumnHeader("ticker");
        await dividendReview.actions.clickColumnHeader("account");
      }
      await dividendReview.assert.orderedRowIdsAre(
        sortedRows(harness.allRows, "account", "asc").slice(0, 10).map((row) => row.id),
      );
      releaseFirst?.();
      await dividendReview.assert.urlContains("sortBy=account");
      await dividendReview.assert.orderedRowIdsAre(
        sortedRows(harness.allRows, "account", "asc").slice(0, 10).map((row) => row.id),
      );
    });

    test(`[review primary failure ${mobile ? "mobile" : "desktop"}]: request page 2 fails then retry succeeds → committed page URL and rows roll back before retry`, async ({
      dividendReview,
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      let failPageTwo = true;
      let releaseFailure: (() => void) | undefined;
      const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
      const harness = await installReviewHarness(page, {
        primary: async (route, url, payload) => {
          if (url.searchParams.get("page") === "2" && failPageTwo) {
            failPageTwo = false;
            await failureGate;
            await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "QA primary failure" }) });
            return;
          }
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
        },
      });
      await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
      if (mobile) {
        await dividendReview.actions.selectMobileSortField("ticker");
        await dividendReview.actions.selectMobileSortDirection("asc");
      } else {
        await dividendReview.actions.clickColumnHeader("ticker");
      }
      const pageOne = sortedRows(harness.allRows, "ticker", "asc").slice(0, 10).map((row) => row.id);
      await dividendReview.assert.orderedRowIdsAre(pageOne);

      await dividendReview.actions.clickNextPage();
      await dividendReview.assert.tableBusy(true);
      await dividendReview.assert.skeletonsAreVisible();
      await dividendReview.assert.paginationIsDisabled();
      await dividendReview.assert.valueEquals(await dividendReview.assert.orderedRowIds(), []);
      releaseFailure?.();
      await dividendReview.assert.primaryErrorIsVisible();
      await dividendReview.assert.urlContains("page=1");
      await dividendReview.assert.orderedRowIdsAre(pageOne);
      await dividendReview.actions.retryPrimary();
      await dividendReview.assert.urlContains("page=2");
      await dividendReview.assert.orderedRowIdsAre(
        sortedRows(harness.allRows, "ticker", "asc").slice(10, 20).map((row) => row.id),
      );
    });

    test(`[review enrichment failure ${mobile ? "mobile" : "desktop"}]: enrichment fails then retries → primary results stay usable`, async ({
      dividendReview,
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      let attempt = 0;
      await installReviewHarness(page, {
        enrichment: async (route) => {
          attempt += 1;
          if (attempt === 1) {
            await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "QA enrichment failure" }) });
          } else {
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reviewEnrichment(3, 2)) });
          }
        },
      });
      await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
      const idsBefore = await dividendReview.assert.orderedRowIds();
      await dividendReview.assert.enrichmentErrorIsVisible();
      await dividendReview.assert.tableBusy(false);
      await dividendReview.actions.retryEnrichment();
      await dividendReview.assert.locatorContains(page.getByTestId("stat-needs-attention"), "3");
      await dividendReview.assert.valueEquals(await dividendReview.assert.orderedRowIds(), idsBefore);
    });
  }

  test("[review exact cache desktop]: return to a previously loaded query → exact rows render without a new primary request", async ({
    dividendReview,
    page,
  }) => {
    const harness = await installReviewHarness(page);
    await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
    await dividendReview.actions.clickColumnHeader("ticker");
    const tickerIds = sortedRows(harness.allRows, "ticker", "asc").slice(0, 10).map((row) => row.id);
    await dividendReview.assert.orderedRowIdsAre(tickerIds);
    await dividendReview.actions.clickColumnHeader("account");
    await dividendReview.assert.orderedRowIdsAre(
      sortedRows(harness.allRows, "account", "asc").slice(0, 10).map((row) => row.id),
    );
    const requestCount = harness.primaryUrls.length;
    await dividendReview.actions.clickColumnHeader("ticker");
    await dividendReview.assert.orderedRowIdsAre(tickerIds);
    await dividendReview.assert.valueEquals(harness.primaryUrls.length, requestCount);
  });
});

test.describe("dividend review — enrichment filter integrity", () => {
  for (const mobile of [false, true]) {
    test(`[review pending source ${mobile ? "mobile" : "desktop"}]: activate pending composition → URL rows total charts and NHI share one filter`, async ({
      dividendReview,
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const harness = await installReviewHarness(page, {
        enrichment: async (route, url) => {
          const pending = url.searchParams.get("sourceComposition") === "pending";
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(reviewEnrichment(pending ? 3 : 7, pending ? 19 : 19)),
          });
        },
      });
      await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
      await dividendReview.assert.nhiRollupPendingLinkIsVisible();
      await dividendReview.actions.clickNhiRollupPendingLink();
      await dividendReview.assert.urlContains("sourceComposition=pending");
      const pendingRows = sortedRows(
        harness.allRows.filter((row) => row.sourceCompositionStatus === "unknown_pending_disclosure"),
        "paymentDate",
        "desc",
      ).slice(0, 10).map((row) => row.id);
      await dividendReview.assert.orderedRowIdsAre(pendingRows);
      await dividendReview.assert.locatorContains(page.getByTestId("stat-needs-attention"), "3");
      dividendReview.assert.valueContains(harness.primaryUrls.at(-1), "sourceComposition=pending");
      dividendReview.assert.valueContains(harness.enrichmentUrls.at(-1), "sourceComposition=pending");
      if (mobile) await dividendReview.assert.viewportHasNoHorizontalOverflow();
    });
  }
});

test.describe("dividend review — server seed and lazy drawer", () => {
  for (const mobile of [false, true]) {
    test(`[review SSR ${mobile ? "mobile" : "desktop"}]: open a deep link while enrichment is deferred → server-primary results remain usable without remount`, async ({
      dividendReview,
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const seeded = await dividendReview.arrange.seedExpectedDividend({
        ticker: mobile ? "QA2" : "QA1",
        exDividendDate: isoDateForMonth(2),
        paymentDate: isoDateForMonth(20),
        cashDividendPerShare: 0.25,
      });
      let releaseEnrichment: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { releaseEnrichment = resolve; });
      const browserPrimaryRequests: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/portfolio/dividends/review/primary")) browserPrimaryRequests.push(request.url());
      });
      await page.route("**/portfolio/dividends/review/enrichment?*", async (route) => {
        await gate;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reviewEnrichment()) });
      });

      await dividendReview.actions.navigateToReviewWithParams(`ticker=${mobile ? "QA2" : "QA1"}`);
      await dividendReview.assert.rowContainsText(seeded.expectedReviewRowId, mobile ? /QA2/ : /QA1/);
      const root = page.getByTestId("dividend-review-page");
      await root.evaluate((element) => element.setAttribute("data-qa-root-sentinel", "ssr"));
      await dividendReview.assert.locatorIsVisible(page.getByTestId("review-enrichment-loading"));
      await dividendReview.assert.valueEquals(browserPrimaryRequests.length, 0);
      releaseEnrichment?.();
      await dividendReview.assert.locatorIsVisible(page.getByTestId("stat-tiles"));
      await dividendReview.assert.locatorHasAttribute(root, "data-qa-root-sentinel", "ssr");
      if (mobile) await dividendReview.assert.viewportHasNoHorizontalOverflow();
    });

    test(`[review expected drawer ${mobile ? "mobile" : "desktop"}]: activate an expected row → summary drawer opens immediately with focus contained`, async ({
      dividendReview,
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const expected = reviewRow(0, {
        rowKind: "expected",
        id: "qa-expected-row",
        ticker: "AQA000",
        postingStatus: "expected",
        reconciliationStatus: "open",
      });
      const detailRequests: string[] = [];
      page.on("request", (request) => {
        if (/\/portfolio\/dividends\/postings\/qa-expected-row(?:\?|$)/.test(request.url())) detailRequests.push(request.url());
      });
      await installReviewHarness(page, { rows: [expected, ...Array.from({ length: 10 }, (_, index) => reviewRow(index + 1))] });
      await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
      if (mobile) {
        await dividendReview.actions.selectMobileSortField("ticker");
        await dividendReview.actions.selectMobileSortDirection("asc");
      } else await dividendReview.actions.clickColumnHeader("ticker");
      const row = page.getByTestId("review-row-qa-expected-row-open");
      await row.focus();
      await row.press("Enter");
      await dividendReview.assert.drawerIsVisible();
      await dividendReview.assert.drawerContains(/AQA000/);
      await dividendReview.assert.locatorHasCount(page.getByTestId("review-drawer-loading"), 0);
      await dividendReview.assert.valueEquals(detailRequests.length, 0);
      await dividendReview.assert.locatorContains(page.getByTestId("ui-drawer"), /AQA000/);
      await dividendReview.actions.closeDrawer();
      await dividendReview.assert.locatorIsFocused(row);
    });

    test(`[review ledger drawer ${mobile ? "mobile" : "desktop"}]: open close and reopen the same version → detail loads locally then reuses cache`, async ({
      dividendReview,
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const ledger = reviewRow(0, { id: "qa-ledger-cache", ticker: "AQA001" });
      const detail: DividendReviewRowDetailDto = { ...ledger, deductions: [], sourceLines: [] };
      let releaseDetail: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { releaseDetail = resolve; });
      let requests = 0;
      await page.route("**/portfolio/dividends/postings/qa-ledger-cache", async (route) => {
        requests += 1;
        await gate;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) });
      });
      await installReviewHarness(page, { rows: [ledger, ...Array.from({ length: 10 }, (_, index) => reviewRow(index + 1))] });
      await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
      if (mobile) {
        await dividendReview.actions.selectMobileSortField("ticker");
        await dividendReview.actions.selectMobileSortDirection("asc");
      } else await dividendReview.actions.clickColumnHeader("ticker");
      const ids = await dividendReview.assert.orderedRowIds();
      await dividendReview.actions.clickRow(ledger.id);
      await dividendReview.assert.drawerLoadingIsVisible();
      await dividendReview.assert.valueEquals(await dividendReview.assert.orderedRowIds(), ids);
      releaseDetail?.();
      await dividendReview.assert.drawerContains(/AQA001/);
      await dividendReview.assert.locatorIsVisible(page.getByTestId("dividend-posting-form"));
      await dividendReview.actions.closeDrawer();
      await dividendReview.actions.clickRow(ledger.id);
      await dividendReview.assert.locatorIsVisible(page.getByTestId("dividend-posting-form"));
      await dividendReview.assert.locatorHasCount(page.getByTestId("review-drawer-loading"), 0);
      await dividendReview.assert.valueEquals(requests, 1);
      if (mobile) await dividendReview.assert.viewportHasNoHorizontalOverflow();
    });

    test(`[review ledger drawer failure ${mobile ? "mobile" : "desktop"}]: detail fails then retries → error remains local and table stays intact`, async ({
      dividendReview,
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const ledger = reviewRow(0, { id: "qa-ledger-failure", ticker: "AQA002" });
      const detail: DividendReviewRowDetailDto = { ...ledger, deductions: [], sourceLines: [] };
      let attempts = 0;
      await page.route("**/portfolio/dividends/postings/qa-ledger-failure", async (route) => {
        attempts += 1;
        await route.fulfill({
          status: attempts === 1 ? 503 : 200,
          contentType: "application/json",
          body: JSON.stringify(attempts === 1 ? { message: "QA drawer failure" } : detail),
        });
      });
      await installReviewHarness(page, { rows: [ledger, ...Array.from({ length: 10 }, (_, index) => reviewRow(index + 1))] });
      await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
      if (mobile) {
        await dividendReview.actions.selectMobileSortField("ticker");
        await dividendReview.actions.selectMobileSortDirection("asc");
      } else await dividendReview.actions.clickColumnHeader("ticker");
      const ids = await dividendReview.assert.orderedRowIds();
      await dividendReview.actions.clickRow(ledger.id);
      await dividendReview.assert.drawerErrorIsVisible();
      await dividendReview.assert.valueEquals(await dividendReview.assert.orderedRowIds(), ids);
      await dividendReview.actions.retryDrawer();
      await dividendReview.assert.locatorIsVisible(page.getByTestId("dividend-posting-form"));
      await dividendReview.assert.valueEquals(attempts, 2);
    });
  }

  test("[review accessibility desktop]: keyboard row activation and chart hover → focus and tooltip remain usable", async ({
    dividendReview,
    page,
  }) => {
    const ledger = reviewRow(0, { id: "qa-focus-row", ticker: "AQA003" });
    const detail: DividendReviewRowDetailDto = { ...ledger, deductions: [], sourceLines: [] };
    await page.route("**/portfolio/dividends/postings/qa-focus-row", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(detail),
    }));
    await installReviewHarness(page, { rows: [ledger, ...Array.from({ length: 10 }, (_, index) => reviewRow(index + 1))] });
    await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
    await dividendReview.actions.clickColumnHeader("ticker");
    const row = page.getByTestId("review-row-qa-focus-row-open");
    await row.focus();
    await row.press("Enter");
    await dividendReview.assert.locatorIsVisible(page.getByTestId("ui-drawer"));
    await dividendReview.actions.closeDrawer();
    await dividendReview.assert.locatorIsFocused(row);
    const chartTarget = page.locator(".recharts-bar-rectangle path").first();
    if (await chartTarget.count()) {
      await chartTarget.hover();
      await dividendReview.assert.locatorIsVisible(page.locator(".recharts-tooltip-wrapper").first());
    }
  });
});

test.describe("dividend review — mutation invalidation", () => {
  test("[review posting mutation]: post an expected row from its drawer → primary and enrichment refresh without remount", async ({
    dividendReview,
    dividends,
    page,
  }) => {
    const expected = reviewRow(0, {
      rowKind: "expected",
      id: "qa-post-expected",
      ticker: "AQA010",
      postingStatus: "expected",
      reconciliationStatus: "open",
    });
    const posted = reviewRow(0, { id: "qa-post-ledger", ticker: "AQA010", version: 1 });
    let didPost = false;
    let enrichmentCalls = 0;
    await installReviewHarness(page, {
      rows: [expected],
      primary: (route, _url, payload) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...payload, reviewRows: [didPost ? posted : expected], total: 1 }),
      }),
      enrichment: (route) => {
        enrichmentCalls += 1;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reviewEnrichment(didPost ? 0 : 1, 0)) });
      },
    });
    await page.route("**/portfolio/dividends/postings", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      didPost = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          dividendLedgerEntry: {
            id: posted.id,
            accountId: posted.accountId,
            dividendEventId: posted.dividendEventId,
            version: posted.version,
            reconciliationStatus: posted.reconciliationStatus,
            sourceCompositionStatus: posted.sourceCompositionStatus,
          },
        }),
      });
    });
    await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
    await dividendReview.actions.clickColumnHeader("ticker");
    const root = page.getByTestId("dividend-review-page");
    await root.evaluate((element) => element.setAttribute("data-qa-root-sentinel", "post"));
    await dividendReview.actions.clickRow(expected.id);
    await dividends.actions.fillReceivedCash(12);
    const enrichmentBefore = enrichmentCalls;
    await dividends.actions.submitPostingForm();
    await dividendReview.assert.locatorIsVisible(page.getByTestId(`review-row-${posted.id}`));
    await dividendReview.assert.locatorIsHidden(page.getByTestId(`review-row-${expected.id}`));
    dividendReview.assert.valueIsGreaterThan(enrichmentCalls, enrichmentBefore);
    await dividendReview.assert.locatorHasAttribute(root, "data-qa-root-sentinel", "post");
  });

  test("[review amendment mutation]: save persisted drawer changes → detail and aggregates refresh without remount", async ({
    dividendReview,
    dividends,
    page,
  }) => {
    const before = reviewRow(0, { id: "qa-amend-ledger", ticker: "AQA011", version: 1, receivedCashAmount: 12 });
    const after = { ...before, version: 2, receivedCashAmount: 99, actualNetAmount: 99 };
    let amended = false;
    let detailCalls = 0;
    let enrichmentCalls = 0;
    await installReviewHarness(page, {
      rows: [before],
      primary: (route, _url, payload) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...payload, reviewRows: [amended ? after : before], total: 1 }),
      }),
      enrichment: (route) => {
        enrichmentCalls += 1;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reviewEnrichment(amended ? 0 : 1, 0)) });
      },
    });
    await page.route("**/portfolio/dividends/postings/qa-amend-ledger", async (route) => {
      detailCalls += 1;
      const detail: DividendReviewRowDetailDto = { ...(amended ? after : before), deductions: [], sourceLines: [] };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) });
    });
    await page.route("**/portfolio/dividends/postings", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      amended = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          dividendLedgerEntry: {
            id: after.id,
            accountId: after.accountId,
            dividendEventId: after.dividendEventId,
            version: after.version,
            reconciliationStatus: after.reconciliationStatus,
            sourceCompositionStatus: after.sourceCompositionStatus,
          },
        }),
      });
    });
    await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
    await dividendReview.actions.clickColumnHeader("ticker");
    const root = page.getByTestId("dividend-review-page");
    await root.evaluate((element) => element.setAttribute("data-qa-root-sentinel", "amend"));
    await dividendReview.actions.clickRow(before.id);
    await dividendReview.assert.locatorIsVisible(page.getByTestId("dividend-posting-form"));
    await dividends.actions.fillReceivedCash(99);
    const enrichmentBefore = enrichmentCalls;
    await dividends.actions.submitPostingForm();
    await dividendReview.assert.locatorContains(page.getByTestId(`review-row-${after.id}`), /99/);
    dividendReview.assert.valueIsGreaterThan(enrichmentCalls, enrichmentBefore);
    await dividendReview.assert.drawerIsHidden();
    await dividendReview.actions.clickRow(after.id);
    await dividendReview.assert.locatorIsVisible(page.getByTestId("dividend-posting-form"));
    await dividendReview.assert.valueEquals(detailCalls, 2);
    await dividendReview.assert.locatorHasAttribute(root, "data-qa-root-sentinel", "amend");
  });
});

test.describe("dividend review — portfolio context isolation", () => {
  test("[review portfolio context]: switch owners while Review is open → previous-context rows disappear before the new context commits", async ({
    contextSwitcher,
    dividendReview,
    page,
  }) => {
    const owner = await seedUser({
      sub: "e2e-review-performance-owner-sub",
      email: "review-performance-owner@example.com",
      name: "Review Performance Owner",
      role: "member",
    });
    const grantee = await seedUser({
      sub: "e2e-review-performance-grantee-sub",
      email: "review-performance-grantee@example.com",
      name: "Review Performance Grantee",
      role: "member",
    });
    await seedResolvedShareFromAdmin(grantee.email, owner.userId);
    await switchIdentity(page, { userId: grantee.userId, role: "member" });

    const selfRow = reviewRow(0, { id: "qa-context-self", ticker: "SELFQA" });
    const ownerRow = reviewRow(1, { id: "qa-context-owner", ticker: "OWNERQA" });
    await installReviewHarness(page, {
      rows: [selfRow],
      primary: (route, _url, payload) => {
        const isOwner = route.request().headers()["x-context-user-id"] === owner.userId;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...payload, reviewRows: [isOwner ? ownerRow : selfRow], total: 1 }),
        });
      },
    });
    await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
    await dividendReview.actions.clickColumnHeader("ticker");
    await dividendReview.assert.locatorIsVisible(page.getByTestId(`review-row-${selfRow.id}`));
    const root = page.getByTestId("dividend-review-page");
    await root.evaluate((element) => element.setAttribute("data-qa-root-sentinel", "context"));

    await contextSwitcher.actions.selectOwner(owner.userId);
    await dividendReview.assert.locatorIsVisible(page.getByTestId(`review-row-${ownerRow.id}`));
    await dividendReview.assert.locatorIsHidden(page.getByTestId(`review-row-${selfRow.id}`));
    await dividendReview.assert.locatorHasAttribute(root, "data-qa-root-sentinel", "context");
    await dividendReview.assert.urlContains("page=1");

    await contextSwitcher.actions.selectSelf();
    await dividendReview.assert.locatorIsVisible(page.getByTestId(`review-row-${selfRow.id}`));
    await dividendReview.assert.locatorIsHidden(page.getByTestId(`review-row-${ownerRow.id}`));
  });

  test("[review portfolio context mobile]: switch context then open Review → no previous-context cards leak", async ({
    contextSwitcher,
    dividendReview,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const owner = await seedUser({
      sub: "e2e-review-performance-mobile-owner-sub",
      email: "review-performance-mobile-owner@example.com",
      name: "Review Performance Mobile Owner",
      role: "member",
    });
    const grantee = await seedUser({
      sub: "e2e-review-performance-mobile-grantee-sub",
      email: "review-performance-mobile-grantee@example.com",
      name: "Review Performance Mobile Grantee",
      role: "member",
    });
    await seedResolvedShareFromAdmin(grantee.email, owner.userId);
    await switchIdentity(page, { userId: grantee.userId, role: "member" });
    const selfRow = reviewRow(0, { id: "qa-context-mobile-self", ticker: "MSELFQA" });
    const ownerRow = reviewRow(1, { id: "qa-context-mobile-owner", ticker: "MOWNERQA" });
    await installReviewHarness(page, {
      rows: [selfRow],
      primary: (route, _url, payload) => {
        const isOwner = route.request().headers()["x-context-user-id"] === owner.userId;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...payload, reviewRows: [isOwner ? ownerRow : selfRow], total: 1 }),
        });
      },
    });
    await openHarnessedReview(page, () => dividendReview.actions.navigateToReview());
    await dividendReview.actions.selectMobileSortField("ticker");
    await dividendReview.assert.locatorIsVisible(page.getByTestId(`review-row-${selfRow.id}`));
    await contextSwitcher.actions.switchTo(owner.userId);
    await dividendReview.actions.selectMobileSortField("account");
    await dividendReview.assert.locatorIsVisible(page.getByTestId(`review-row-${ownerRow.id}`));
    await dividendReview.assert.locatorIsHidden(page.getByTestId(`review-row-${selfRow.id}`));
    await dividendReview.assert.viewportHasNoHorizontalOverflow();
  });
});
