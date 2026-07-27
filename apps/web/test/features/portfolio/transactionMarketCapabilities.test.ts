import { describe, expect, it } from "vitest";
import { resolveTransactionMarketCapabilityState } from "../../../features/portfolio/transactionMarketCapabilities";

describe("transactionMarketCapabilities", () => {
  const capabilities = {
    configuredMarkets: ["TW", "US"],
    configuredCurrencies: ["TWD", "USD"],
  } as const;

  it("preserves ALL when all configured markets are allowed", () => {
    expect(resolveTransactionMarketCapabilityState(capabilities, "ALL")).toEqual({
      configuredMarkets: ["TW", "US"],
      filterMarketCode: "ALL",
      normalization: null,
    });
  });

  it("normalizes stale market filters to the deterministic configured fallback", () => {
    const result = resolveTransactionMarketCapabilityState({
      configuredMarkets: ["TW"],
      configuredCurrencies: ["TWD"],
    }, "US");

    expect(result.configuredMarkets).toEqual(["TW"]);
    expect(result.filterMarketCode).toBe("TW");
    expect(result.normalization).toEqual({
      requested: "US",
      effective: "TW",
      reason: "unconfigured_market",
    });
  });

  it("collapses to ALL when no configured markets remain", () => {
    const result = resolveTransactionMarketCapabilityState({
      configuredMarkets: [],
      configuredCurrencies: [],
    }, "US");

    expect(result).toEqual({
      configuredMarkets: [],
      filterMarketCode: "ALL",
      normalization: {
        requested: "US",
        effective: null,
        reason: "no_configured_markets",
      },
    });
  });
});
