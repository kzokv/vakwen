import { describe, expect, it } from "vitest";
import type { PortfolioCapabilitiesDto } from "@vakwen/shared-types";
import {
  buildAccountsSetupHref,
  getPortfolioCapabilityOptionSets,
  normalizeCapabilityReturnTo,
  normalizePortfolioMarketSelection,
  normalizePortfolioReportScopeSelection,
  normalizePortfolioReportingCurrencySelection,
} from "../../../features/portfolio-capabilities/portfolioCapabilities";

describe("portfolioCapabilities", () => {
  it("deduplicates configured options while preserving received order", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["TW", "US", "TW"],
      configuredCurrencies: ["TWD", "USD", "TWD"],
    };

    expect(getPortfolioCapabilityOptionSets(capabilities)).toEqual({
      configuredMarkets: ["TW", "US"],
      configuredReportScopes: ["all", "TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    });
  });

  it("keeps single-market and single-currency selections fixed when only one option exists", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["TW"],
      configuredCurrencies: ["TWD"],
    };

    expect(normalizePortfolioMarketSelection(capabilities, null)).toEqual({
      requested: null,
      effective: "TW",
      reason: null,
    });
    expect(normalizePortfolioReportScopeSelection(capabilities, "all")).toEqual({
      requested: "all",
      effective: "TW",
      reason: null,
    });
    expect(normalizePortfolioReportingCurrencySelection(capabilities, null)).toEqual({
      requested: null,
      effective: "TWD",
      reason: null,
    });
  });

  it("returns empty reasons for zero configured markets and currencies", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: [],
      configuredCurrencies: [],
    };

    expect(normalizePortfolioMarketSelection(capabilities, "TW")).toEqual({
      requested: "TW",
      effective: null,
      reason: "no_configured_markets",
    });
    expect(normalizePortfolioReportScopeSelection(capabilities, "all")).toEqual({
      requested: "all",
      effective: null,
      reason: "no_configured_markets",
    });
    expect(normalizePortfolioReportingCurrencySelection(capabilities, "USD")).toEqual({
      requested: "USD",
      effective: null,
      reason: "no_configured_currencies",
    });
  });

  it("falls back deterministically for stale markets and stale currencies", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    };

    expect(normalizePortfolioMarketSelection(capabilities, "AU")).toEqual({
      requested: "AU",
      effective: "TW",
      reason: "unconfigured_market",
    });
    expect(normalizePortfolioReportScopeSelection(capabilities, "AU")).toEqual({
      requested: "AU",
      effective: "all",
      reason: "unconfigured_market",
    });
    expect(normalizePortfolioReportingCurrencySelection(capabilities, "AUD")).toEqual({
      requested: "AUD",
      effective: "TWD",
      reason: "unconfigured_currency",
    });
  });

  it("preserves all for multi-market report scopes", () => {
    const capabilities: PortfolioCapabilitiesDto = {
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    };

    expect(normalizePortfolioReportScopeSelection(capabilities, null)).toEqual({
      requested: null,
      effective: "all",
      reason: null,
    });
    expect(normalizePortfolioReportScopeSelection(capabilities, "all")).toEqual({
      requested: "all",
      effective: "all",
      reason: null,
    });
  });

  it("normalizes safe internal return routes for account setup links", () => {
    expect(normalizeCapabilityReturnTo("/reports?scope=all")).toBe("/reports?scope=all");
    expect(normalizeCapabilityReturnTo("https://evil.example")).toBeNull();
    expect(normalizeCapabilityReturnTo("/\\evil.example")).toBeNull();
    expect(buildAccountsSetupHref("/reports?scope=all")).toBe(
      "/settings/accounts?returnTo=%2Freports%3Fscope%3Dall",
    );
    expect(buildAccountsSetupHref("https://evil.example")).toBe("/settings/accounts");
  });
});
