import { describe, expect, it } from "vitest";
import { derivePortfolioCapabilities } from "./portfolioCapabilities.js";

interface AccountWithMetadata {
  defaultCurrency: string;
  accountType: "broker" | "bank" | "wallet";
}

describe("derivePortfolioCapabilities", () => {
  it("deduplicates currencies and preserves canonical ordering", () => {
    expect(derivePortfolioCapabilities([
      { defaultCurrency: "USD" },
      { defaultCurrency: "TWD" },
      { defaultCurrency: "USD" },
      { defaultCurrency: "JPY" },
      { defaultCurrency: "AUD" },
    ])).toEqual({
      configuredMarkets: ["TW", "US", "AU", "JP"],
      configuredCurrencies: ["TWD", "USD", "AUD", "JPY"],
    });
  });

  it("is independent of input account order and treats account types as metadata only", () => {
    const firstInput: AccountWithMetadata[] = [
      { defaultCurrency: "JPY", accountType: "wallet" },
      { defaultCurrency: "KRW", accountType: "bank" },
      { defaultCurrency: "USD", accountType: "broker" },
    ];
    const secondInput: AccountWithMetadata[] = [
      { defaultCurrency: "USD", accountType: "wallet" },
      { defaultCurrency: "JPY", accountType: "broker" },
      { defaultCurrency: "KRW", accountType: "bank" },
    ];
    const first = derivePortfolioCapabilities(firstInput);
    const second = derivePortfolioCapabilities(secondInput);

    expect(first).toEqual({
      configuredMarkets: ["US", "KR", "JP"],
      configuredCurrencies: ["USD", "KRW", "JPY"],
    });
    expect(second).toEqual(first);
  });

  it("keeps one capability per market even with multiple same-market accounts", () => {
    const input: AccountWithMetadata[] = [
      { defaultCurrency: "USD", accountType: "broker" },
      { defaultCurrency: "USD", accountType: "bank" },
      { defaultCurrency: "USD", accountType: "wallet" },
    ];
    expect(derivePortfolioCapabilities(input)).toEqual({
      configuredMarkets: ["US"],
      configuredCurrencies: ["USD"],
    });
  });

  it("ignores unsupported currencies", () => {
    expect(derivePortfolioCapabilities([
      { defaultCurrency: "EUR" },
      { defaultCurrency: "USD" },
    ])).toEqual({
      configuredMarkets: ["US"],
      configuredCurrencies: ["USD"],
    });
  });

  it("returns empty capabilities for zero accounts", () => {
    expect(derivePortfolioCapabilities([])).toEqual({
      configuredMarkets: [],
      configuredCurrencies: [],
    });
  });
});
