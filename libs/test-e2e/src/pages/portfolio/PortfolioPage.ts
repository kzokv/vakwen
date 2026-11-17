import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@vakwen/test-framework/core";

export interface TPortfolioElements extends TElementLocatorHelpers {
  holdingsTable: Locator;
  portfolioIntro: Locator;
  firstHoldingRow: Locator;
  holdingGroupRow: (ticker: string, marketCode: string) => Locator;
  holdingGroupToggle: (ticker: string, marketCode: string) => Locator;
  holdingChildRow: (ticker: string, marketCode: string, accountId: string) => Locator;
  holdingLink: (symbol: string) => Locator;
  displayModeSelect: Locator;
  displayModeAggregated: Locator;
  displayModeExpanded: Locator;
  displayModeAccount: Locator;
  filterMarket: Locator;
  filterAccount: Locator;
  filterStatus: Locator;
  filterColumns: Locator;
  allocationBasisSelect: Locator;
  allocationBasisMarketValue: Locator;
  allocationBasisCostBasis: Locator;
  holdingDetailButton: (ticker: string, marketCode: string, accountId: string) => Locator;
  capitalReduction: (name: string) => Locator;
  capitalReductionMetric: (section: string, label: string) => Locator;
  holdingActivity: Locator;
  capitalReductionAlert: Locator;
  capitalReductionEditPreview: Locator;
}

export class PortfolioPage extends BasePage<TPortfolioElements> {
  async captureCapitalReduction(path: string, section = "panel"): Promise<void> {
    const region = section === "valuation" ? this.locate("capital-reduction-action").getByTestId("capital-reduction-valuation") : this.locate(`capital-reduction-${section}`);
    await region.getByRole("heading").first().scrollIntoViewIfNeeded();
    await this.page.screenshot({ path, fullPage: true });
  }

  async capitalReductionOverflow(): Promise<number> {
    return this.page.getByRole("dialog").evaluate(element => element.scrollWidth - element.clientWidth);
  }

  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      holdingDetailButton: (ticker, marketCode, accountId) => this.locate(`holding-child-open-detail-${ticker}-${marketCode}-${accountId}`).filter({ visible: true }),
      capitalReduction: (name) => this.locate(`capital-reduction-${name}`),
      capitalReductionMetric: (section, label) => this.withinByCss(this.locate(`capital-reduction-${section}`), section === "calculation" ? ":scope > div" : "dl > div").filter({ has: this.page.getByText(label, { exact: true }) }).locator("dd"),
      holdingActivity: this.locate("holding-activity-detail"),
      capitalReductionAlert: this.withinByRole(this.locate("capital-reduction-panel"), "alert"),
      capitalReductionEditPreview: this.withinByRole(this.locate("capital-reduction-editor"), "button", { name: "Back to editing", exact: true }),
      holdingsTable: this.locate("holdings-table", "Holdings Table"),
      portfolioIntro: this.locate("portfolio-intro", "Portfolio Intro"),
      firstHoldingRow: this.nth(this.locate("holdings-table"), "tbody tr", 0, "First Holding Row"),
      holdingGroupRow: (ticker: string, marketCode: string) =>
        this.locate(`holding-group-row-${ticker}-${marketCode}`, `Holding Group Row ${ticker}/${marketCode}`),
      holdingGroupToggle: (ticker: string, marketCode: string) =>
        this.locate(`holding-group-toggle-${ticker}-${marketCode}`, `Holding Group Toggle ${ticker}/${marketCode}`),
      holdingChildRow: (ticker: string, marketCode: string, accountId: string) =>
        this.locate(
          `holding-child-row-${ticker}-${marketCode}-${accountId}`,
          `Holding Child Row ${ticker}/${marketCode}/${accountId}`,
        ),
      holdingLink: (symbol: string) =>
        this.withDescription(
          this.locate("holdings-table").getByRole("link", { name: symbol }),
          `Holding Link ${symbol}`,
        ),
      displayModeSelect: this.locate("holdings-display-mode-select", "Holdings Display Mode Select"),
      displayModeAggregated: this.locate("holdings-display-mode-aggregated", "Holdings Display Mode Aggregated"),
      displayModeExpanded: this.locate("holdings-display-mode-expanded", "Holdings Display Mode Expanded"),
      displayModeAccount: this.locate("holdings-display-mode-accounts", "Holdings Display Mode Account"),
      filterMarket: this.locate("holdings-filter-market", "Holdings Filter Market"),
      filterAccount: this.locate("holdings-filter-account", "Holdings Filter Account"),
      filterStatus: this.locate("holdings-filter-status", "Holdings Filter Status"),
      filterColumns: this.locate("holdings-filter-columns", "Holdings Filter Columns"),
      allocationBasisSelect: this.locate("holdings-allocation-basis-select", "Holdings Allocation Basis Select"),
      allocationBasisMarketValue: this.locate(
        "holdings-allocation-basis-market-value",
        "Holdings Allocation Basis Market Value",
      ),
      allocationBasisCostBasis: this.locate(
        "holdings-allocation-basis-cost-basis",
        "Holdings Allocation Basis Cost Basis",
      ),
    };
  }
}
