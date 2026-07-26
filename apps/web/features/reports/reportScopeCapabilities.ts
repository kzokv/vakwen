import { MARKET_CODES, REPORT_SCOPES, type MarketCode, type PortfolioCapabilitiesDto, type PortfolioSelectionNormalizationResult, type ReportScope } from "@vakwen/shared-types";
import {
  getPortfolioCapabilityOptionSets,
  normalizePortfolioReportScopeSelection,
} from "../portfolio-capabilities/portfolioCapabilities";

export interface ReportScopeCapabilityState {
  mode: "loading" | "zero" | "single" | "multiple";
  configuredMarkets: MarketCode[];
  configuredReportScopes: ReportScope[];
  scope: ReportScope;
  normalization: PortfolioSelectionNormalizationResult<ReportScope> | null;
}

export function resolveReportScopeCapabilityState(
  capabilities: PortfolioCapabilitiesDto | null,
  requestedScope: ReportScope,
): ReportScopeCapabilityState {
  if (!capabilities) {
    return {
      mode: "loading",
      configuredMarkets: [...MARKET_CODES],
      configuredReportScopes: [...REPORT_SCOPES],
      scope: requestedScope,
      normalization: null,
    };
  }

  const { configuredMarkets, configuredReportScopes } = getPortfolioCapabilityOptionSets(capabilities);
  if (configuredMarkets.length === 0) {
    return {
      mode: "zero",
      configuredMarkets,
      configuredReportScopes,
      scope: "all",
      normalization: requestedScope === "all"
        ? null
        : {
            requested: requestedScope,
            effective: null,
            reason: "no_configured_markets",
          },
    };
  }

  const normalization = normalizePortfolioReportScopeSelection(capabilities, requestedScope);
  return {
    mode: configuredMarkets.length === 1 ? "single" : "multiple",
    configuredMarkets,
    configuredReportScopes,
    scope: normalization.effective ?? configuredReportScopes[0] ?? "all",
    normalization,
  };
}
