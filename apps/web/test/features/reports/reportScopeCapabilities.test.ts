import { describe, expect, it } from "vitest";
import type { PortfolioCapabilitiesDto } from "@vakwen/shared-types";
import { resolveReportScopeCapabilityState } from "../../../features/reports/reportScopeCapabilities";

describe("reportScopeCapabilities", () => {
  it("returns a loading state while capabilities are unavailable", () => {
    expect(resolveReportScopeCapabilityState(null, "all")).toEqual({
      mode: "loading",
      configuredMarkets: ["TW", "US", "AU", "KR", "JP"],
      configuredReportScopes: ["all", "TW", "US", "AU", "KR", "JP"],
      scope: "all",
      normalization: null,
    });
  });

  it("returns a zero-configured-markets state", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: [],
      configuredCurrencies: [],
    };

    expect(resolveReportScopeCapabilityState(capabilities, "US")).toEqual({
      mode: "zero",
      configuredMarkets: [],
      configuredReportScopes: [],
      scope: "all",
      normalization: {
        requested: "US",
        effective: null,
        reason: "no_configured_markets",
      },
    });
  });

  it("collapses a single configured market into a fixed report scope", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["TW"],
      configuredCurrencies: ["TWD"],
    };

    expect(resolveReportScopeCapabilityState(capabilities, "all")).toEqual({
      mode: "single",
      configuredMarkets: ["TW"],
      configuredReportScopes: ["TW"],
      scope: "TW",
      normalization: {
        requested: "all",
        effective: "TW",
        reason: null,
      },
    });
  });

  it("deduplicates configured markets and preserves their received order", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["TW", "US", "TW"],
      configuredCurrencies: ["TWD", "USD"],
    };

    expect(resolveReportScopeCapabilityState(capabilities, "US")).toEqual({
      mode: "multiple",
      configuredMarkets: ["TW", "US"],
      configuredReportScopes: ["all", "TW", "US"],
      scope: "US",
      normalization: {
        requested: "US",
        effective: "US",
        reason: null,
      },
    });
  });

  it("normalizes stale report scopes back to all for multi-market portfolios", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["TW", "AU"],
      configuredCurrencies: ["TWD", "AUD"],
    };

    expect(resolveReportScopeCapabilityState(capabilities, "US")).toEqual({
      mode: "multiple",
      configuredMarkets: ["TW", "AU"],
      configuredReportScopes: ["all", "TW", "AU"],
      scope: "all",
      normalization: {
        requested: "US",
        effective: "all",
        reason: "unconfigured_market",
      },
    });
  });
});
