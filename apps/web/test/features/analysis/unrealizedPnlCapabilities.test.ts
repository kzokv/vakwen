import { describe, expect, it } from "vitest";
import type { PortfolioCapabilitiesDto } from "@vakwen/shared-types";
import { resolveUnrealizedPnlCapabilityState } from "../../../features/analysis/unrealizedPnlCapabilities";

describe("unrealizedPnlCapabilities", () => {
  it("returns loading state while capabilities are unavailable", () => {
    expect(resolveUnrealizedPnlCapabilityState(null, ["US", "TW", "US"], "USD")).toEqual({
      mode: "loading",
      configuredMarkets: ["TW", "US", "AU", "KR", "JP"],
      configuredCurrencies: ["TWD", "USD", "AUD", "KRW", "JPY"],
      effectiveMarkets: ["US", "TW"],
      effectiveReportingCurrency: "USD",
      marketNormalization: null,
      reportingCurrencyNormalization: null,
    });
  });

  it("returns zero state when no configured markets remain", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: [],
      configuredCurrencies: [],
    };

    expect(resolveUnrealizedPnlCapabilityState(capabilities, ["TW"], "USD")).toEqual({
      mode: "zero",
      configuredMarkets: [],
      configuredCurrencies: [],
      effectiveMarkets: [],
      effectiveReportingCurrency: null,
      marketNormalization: {
        requested: ["TW"],
        effective: [],
        reason: "no_configured_markets",
      },
      reportingCurrencyNormalization: {
        requested: "USD",
        effective: null,
        reason: "no_configured_currencies",
      },
    });
  });

  it("keeps all-configured semantics for a single TW market when no explicit market filter is requested", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["TW"],
      configuredCurrencies: ["TWD"],
    };

    expect(resolveUnrealizedPnlCapabilityState(capabilities, [], "TWD")).toEqual({
      mode: "single",
      configuredMarkets: ["TW"],
      configuredCurrencies: ["TWD"],
      effectiveMarkets: [],
      effectiveReportingCurrency: "TWD",
      marketNormalization: {
        requested: [],
        effective: [],
        reason: null,
      },
      reportingCurrencyNormalization: {
        requested: "TWD",
        effective: "TWD",
        reason: null,
      },
    });
  });

  it("preserves configured availability across TW+US markets and TWD+USD currencies", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    };

    expect(resolveUnrealizedPnlCapabilityState(capabilities, [], "USD")).toEqual({
      mode: "multiple",
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
      effectiveMarkets: [],
      effectiveReportingCurrency: "USD",
      marketNormalization: {
        requested: [],
        effective: [],
        reason: null,
      },
      reportingCurrencyNormalization: {
        requested: "USD",
        effective: "USD",
        reason: null,
      },
    });
  });

  it("keeps capability availability when a stale market selection drops to empty", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["TW"],
      configuredCurrencies: ["TWD"],
    };

    expect(resolveUnrealizedPnlCapabilityState(capabilities, ["US"], "TWD")).toEqual({
      mode: "single",
      configuredMarkets: ["TW"],
      configuredCurrencies: ["TWD"],
      effectiveMarkets: [],
      effectiveReportingCurrency: "TWD",
      marketNormalization: {
        requested: ["US"],
        effective: [],
        reason: "unconfigured_market",
      },
      reportingCurrencyNormalization: {
        requested: "TWD",
        effective: "TWD",
        reason: null,
      },
    });
  });

  it("drops only unavailable markets from mixed selections", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    };

    expect(resolveUnrealizedPnlCapabilityState(capabilities, ["AU", "US", "TW"], "USD")).toEqual({
      mode: "multiple",
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
      effectiveMarkets: ["US", "TW"],
      effectiveReportingCurrency: "USD",
      marketNormalization: {
        requested: ["AU", "US", "TW"],
        effective: ["US", "TW"],
        reason: "unconfigured_market",
      },
      reportingCurrencyNormalization: {
        requested: "USD",
        effective: "USD",
        reason: null,
      },
    });
  });

  it("falls back to the first configured reporting currency when the requested one is stale", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    };

    expect(resolveUnrealizedPnlCapabilityState(capabilities, ["US"], "AUD")).toEqual({
      mode: "multiple",
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
      effectiveMarkets: ["US"],
      effectiveReportingCurrency: "TWD",
      marketNormalization: {
        requested: ["US"],
        effective: ["US"],
        reason: null,
      },
      reportingCurrencyNormalization: {
        requested: "AUD",
        effective: "TWD",
        reason: "unconfigured_currency",
      },
    });
  });

  it("deduplicates configured markets, configured currencies, and requested markets canonically", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["US", "TW", "US"],
      configuredCurrencies: ["USD", "TWD", "USD"],
    };

    expect(resolveUnrealizedPnlCapabilityState(capabilities, ["US", "TW", "US"], "USD")).toEqual({
      mode: "multiple",
      configuredMarkets: ["US", "TW"],
      configuredCurrencies: ["USD", "TWD"],
      effectiveMarkets: ["US", "TW"],
      effectiveReportingCurrency: "USD",
      marketNormalization: {
        requested: ["US", "TW"],
        effective: ["US", "TW"],
        reason: null,
      },
      reportingCurrencyNormalization: {
        requested: "USD",
        effective: "USD",
        reason: null,
      },
    });
  });
});
