import type { Response } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { DividendReviewPage } from "../../pages/dividends/DividendReviewPage.js";

export class DividendReviewActions extends AppBaseActions {
  declare protected readonly _instance: DividendReviewPage;

  private get el() {
    return this._instance.elements;
  }

  // ─── Navigation ──────────────────────────────────────────────────────────

  @Step()
  async navigateToReview(): Promise<void> {
    // Phase 5a — /dividends/review was merged into /dividends?view=ledger.
    await this.mxNavigateToRoute("/dividends?view=ledger", TestEnv.appBaseUrl);
  }

  @Step()
  async navigateToReviewWithParams(params: string): Promise<void> {
    // Phase 5a — caller-supplied params are merged with view=ledger.
    const prefix = params.includes("view=") ? "" : "view=ledger&";
    await this.mxNavigateToRoute(`/dividends?${prefix}${params}`, TestEnv.appBaseUrl);
  }

  @Step()
  async navigateToCalendar(): Promise<void> {
    // Phase 5a probes the ledger first on /dividends when open review items
    // exist, so calendar tests use the explicit tab URL.
    await this.mxNavigateToRoute("/dividends?view=calendar", TestEnv.appBaseUrl);
  }

  // ─── Filter bar — presets ────────────────────────────────────────────────

  @Step()
  async clickPreset(presetName: string): Promise<void> {
    await this.uiActions.click.perform(this.el.preset(presetName));
  }

  @Step()
  async selectYearRange(fromYear: number, toYear: number): Promise<Response> {
    const responsePromise = this.mxWaitForResponse(
      (response) =>
        response.request().method() === "GET"
        && response.url().includes("/portfolio/dividends/review/primary")
        && response.url().includes(`fromPaymentDate=${fromYear}-01-01`)
        && response.url().includes(`toPaymentDate=${toYear}-12-31`),
    );

    await this.uiActions.click.perform(this.el.yearRangeTrigger);
    await this.uiActions.click.perform(this.el.yearOption(fromYear));
    if (toYear !== fromYear) {
      await this.uiActions.click.perform(this.el.yearOption(toYear));
    }
    const response = await responsePromise;
    await response.finished();
    return response;
  }

  // ─── Filter bar — date inputs ────────────────────────────────────────────

  @Step()
  async fillDateFrom(value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.dateFrom, value);
  }

  @Step()
  async fillDateTo(value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.dateTo, value);
  }

  @Step()
  async clearDateTo(): Promise<void> {
    await this.el.dateTo.clear();
    await this.el.dateTo.blur();
  }

  @Step()
  async blurDateInputs(): Promise<void> {
    await this.el.dateFrom.blur();
    await this.el.dateTo.blur();
  }

  // ─── Filter bar — ticker ─────────────────────────────────────────────────

  @Step()
  async fillTicker(value: string): Promise<void> {
    if (!await this.el.tickerSearch.isVisible().catch(() => false)) {
      await this.uiActions.click.perform(this.el.tickerSummary);
    }
    await this.uiActions.fill.perform(this.el.tickerSearch, value);
  }

  @Step()
  async submitTickerFilter(): Promise<void> {
    const ticker = (await this.el.tickerSearch.inputValue()).trim();
    if (!ticker) return;
    await this.toggleTickerOption(ticker);
  }

  @Step()
  async toggleTickerOption(ticker: string): Promise<void> {
    await this.uiActions.click.perform(this.el.tickerCheckbox(ticker));
  }

  @Step()
  async clearTickerFilter(): Promise<void> {
    const responsePromise = this.mxWaitForResponse(
      (response) =>
        response.request().method() === "GET"
        && response.url().includes("/portfolio/dividends/review"),
    ).catch(() => undefined);
    await this.uiActions.click.perform(this.el.tickerClear);
    await responsePromise;
  }

  // ─── Filter bar — dropdowns ──────────────────────────────────────────────

  @Step()
  async openAccountFilter(): Promise<void> {
    await this.uiActions.click.perform(this.el.accountSummary);
  }

  @Step()
  async openAccountFilterWithKeyboard(): Promise<void> {
    await this.mxFocus(this.el.accountSummary);
    await this.mxPressKey("Enter");
  }

  @Step()
  async toggleAccount(value: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountOption(value));
  }

  @Step()
  async toggleAccountWithKeyboard(value: string): Promise<void> {
    await this.mxFocus(this.el.accountOption(value));
    await this.mxPressKey("Space");
  }

  @Step()
  async selectAllAccountsWithKeyboard(): Promise<void> {
    await this.mxFocus(this.el.accountAll);
    await this.mxPressKey("Space");
  }

  @Step()
  async openCashStatusFilter(): Promise<void> {
    await this.uiActions.click.perform(this.el.cashStatusSummary);
  }

  @Step()
  async toggleCashStatus(value: string): Promise<void> {
    await this.uiActions.click.perform(this.el.cashStatusOption(value));
  }

  @Step()
  async openStockStatusFilter(): Promise<void> {
    await this.uiActions.click.perform(this.el.stockStatusSummary);
  }

  @Step()
  async toggleStockStatus(value: string): Promise<void> {
    await this.uiActions.click.perform(this.el.stockStatusOption(value));
  }

  // ─── Chart interactions ���─────────────────────────────────────────────────

  @Step()
  async clickChartTab(tab: "monthly" | "accumulated" | "byTicker"): Promise<void> {
    await this.uiActions.click.perform(this.el.chartTab(tab));
  }

  @Step()
  async clickGranularity(level: "month" | "quarter" | "year"): Promise<void> {
    await this.uiActions.click.perform(this.el.chartGranularityButton(level));
  }

  @Step()
  async selectCurrency(currencyCode: string): Promise<void> {
    await this.uiActions.select.perform(this.el.currencySelect, currencyCode);
  }

  // ─── Table interactions ──────────────────────────────────────────────────

  @Step()
  async clickColumnHeader(field: string): Promise<void> {
    await this.uiActions.click.perform(this.el.tableHeader(field).first());
  }

  @Step()
  async selectMobileSortField(field: string): Promise<void> {
    await this.uiActions.select.perform(this.el.mobileSortField, field);
  }

  @Step()
  async selectMobileSortDirection(direction: "asc" | "desc"): Promise<void> {
    await this.uiActions.select.perform(this.el.mobileSortDirection, direction);
  }

  @Step()
  async clickRow(ledgerEntryId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.row(ledgerEntryId));
  }

  @Step()
  async clickMarkMatched(ledgerEntryId: string): Promise<Response> {
    const patchResponsePromise = this.mxWaitForResponse(
      (response) =>
        response.request().method() === "PATCH"
        && response.url().includes("/portfolio/dividends/postings/")
        && response.url().includes("/reconciliation"),
    );

    await this.uiActions.click.perform(this.el.markMatchedButton(ledgerEntryId));
    return await patchResponsePromise;
  }

  // ─── Pagination ──────────────────────────────────────────────────────────

  @Step()
  async clickNextPage(): Promise<void> {
    await this.uiActions.click.perform(this.el.paginationNext);
  }

  @Step()
  async clickPreviousPage(): Promise<void> {
    await this.uiActions.click.perform(this.el.paginationPrev);
  }

  @Step()
  async selectPageSize(limit: 10 | 25 | 50): Promise<void> {
    await this.uiActions.select.perform(this.el.pageSize, String(limit));
  }

  @Step()
  async retryPrimary(): Promise<void> {
    await this.uiActions.click.perform(this.el.primaryRetry);
  }

  @Step()
  async retryEnrichment(): Promise<void> {
    await this.uiActions.click.perform(this.el.enrichmentRetry);
  }

  @Step()
  async closeDrawer(): Promise<void> {
    await this.uiActions.click.perform(this.el.drawer.closeButton);
  }

  @Step()
  async retryDrawer(): Promise<void> {
    await this.uiActions.click.perform(this.el.drawerRetry);
  }

  @Step()
  async openTickerTransactions(): Promise<void> {
    await this.uiActions.click.perform(this.el.openTickerTransactions);
  }

  // ─── Calendar page navigation ───��────────────────────────────────────────

  @Step()
  async clickNhiRollupPendingLink(): Promise<void> {
    await this.uiActions.click.perform(this.el.nhiRollupPendingLink);
  }

  @Step()
  async clickViewAllDividendsLink(): Promise<void> {
    await this.uiActions.click.perform(this.el.pendingLink);
    await this.mxWaitForAppReady();
  }
}
