import { BaseArrange } from "@vakwen/test-framework/mixins";
import { Step } from "@vakwen/test-framework/decorators";
import type { AccountCapitalReductionDto, CapitalReductionInputDto } from "@vakwen/shared-types";
import { apiUrl } from "../../utils/url.js";

import type { PortfolioPage } from "../../pages/portfolio/PortfolioPage.js";

/** Synthetic capital-reduction setup and public read oracles. */
export class PortfolioArrange extends BaseArrange {
  declare protected readonly _instance: PortfolioPage;

  @Step()
  async setCapitalReductionLocale(locale: "en" | "zh-TW"): Promise<void> {
    const response = await this.request.patch(apiUrl("/settings"), { headers: { "x-user-id": this.userId ?? "user-1" }, data: { locale } });
    if (!response.ok()) throw new Error(`setCapitalReductionLocale: ${response.status()} ${await response.text()}`);
  }

  @Step()
  async capitalReductionOAuthRole(idToken: string, role: "admin" | "viewer"): Promise<string> {
    const response = await this.request.post(apiUrl(`/__e2e/oauth-session?role=${role}`), { data: { id_token: idToken } });
    if (!response.ok()) throw new Error(`capitalReductionOAuthRole: ${response.status()} ${await response.text()}`);
    return response.headers()["set-cookie"] ?? "";
  }

  @Step()
  async capitalReductionWriteStatus(): Promise<number> {
    const data: CapitalReductionInputDto = {
      operation: "POST", accountId: "acc-1", ticker: "SYNTH", confirmedWholeQuantity: 542,
      evidenceReference: "SYNTH-reader-denied", reason: "Synthetic readonly permission check", repaymentReceipts: [],
      announcement: {
        eventId: "SYNTH-reader-denied-event", version: 1, ticker: "SYNTH", marketCode: "TW", venue: "TWSE", instrumentType: "STOCK", currency: "TWD",
        officialReference: "SYNTH-reader-denied-source", sourceUrl: "https://example.com/synthetic-capital-reduction", publishedDate: "2026-01-16", reductionDate: "2026-01-20",
        suspensionStartDate: "2026-01-19", suspensionEndDate: "2026-01-25", exchangeRecordDate: "2026-01-22", conversionDate: "2026-01-26", scheduledPaymentDate: "2026-01-28",
        ratioNumerator: "0.5420491512", ratioDenominator: "1", repaymentPerOldShare: "4.579", payoutRounding: "FLOOR",
      },
    };
    const response = await this.request.post(apiUrl("/portfolio/capital-reductions/preview"), { data });
    return response.status();
  }

  @Step()
  async createCapitalReductionScopeAccount(): Promise<string> {
    const response = await this.request.post(apiUrl("/accounts"), { headers: { "x-user-id": this.userId ?? "user-1" }, data: { name: "Synthetic secondary account", defaultCurrency: "TWD", accountType: "broker" } });
    if (!response.ok()) throw new Error(`createCapitalReductionScopeAccount: ${response.status()} ${await response.text()}`);
    const result = await response.json() as { account: { id: string } };
    return result.account.id;
  }

  @Step()
  async readCapitalReductions(ticker = "SYNTH"): Promise<AccountCapitalReductionDto[]> {
    const response = await this.request.get(apiUrl(`/portfolio/capital-reductions?accountId=acc-1&ticker=${ticker}`), { headers: { "x-user-id": this.userId ?? "user-1" } });
    if (!response.ok()) throw new Error(`readCapitalReductions: ${response.status()} ${await response.text()}`);
    return (await response.json() as { actions: AccountCapitalReductionDto[] }).actions;
  }

  @Step()
  async capitalReductionFinancialOracle(ticker = "SYNTH"): Promise<{ quantity: number; cost: number; cashEffectCount: number }> {
    const headers = { "x-user-id": this.userId ?? "user-1" };
    const [holdingsResponse, cashResponse] = await Promise.all([
      this.request.get(apiUrl("/portfolio/holdings"), { headers }),
      this.request.get(apiUrl("/portfolio/cash-ledger?accountId=acc-1&limit=100"), { headers }),
    ]);
    if (!holdingsResponse.ok() || !cashResponse.ok()) throw new Error("Financial oracle read failed");
    const holding = (await holdingsResponse.json() as Array<{ ticker: string; accountId: string; quantity: number; costBasisAmount: number }>).find(row => row.ticker === ticker && row.accountId === "acc-1");
    const cash = await cashResponse.json() as { entries: Array<{ relatedCapitalReductionId?: string }> };
    return { quantity: holding?.quantity ?? 0, cost: holding?.costBasisAmount ?? 0, cashEffectCount: cash.entries.filter(row => Boolean(row.relatedCapitalReductionId)).length };
  }

  @Step()
  async failNextCapitalReductionGeneration(ticker = "SYNTH"): Promise<void> {
    const [action] = await this.readCapitalReductions(ticker);
    if (!action) throw new Error("Expected a synthetic capital reduction before arming failure");
    const response = await this.request.post(apiUrl(`/__e2e/capital-reductions/${action.id}/fail-next-generation`), { headers: { "x-user-id": this.userId ?? "user-1" } });
    if (!response.ok()) throw new Error(`failNextCapitalReductionGeneration: ${response.status()} ${await response.text()}`);
  }
}
