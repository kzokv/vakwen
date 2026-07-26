import {
  ACCOUNT_DEFAULT_CURRENCIES,
  type AccountDefaultCurrency,
  type PortfolioCapabilitiesDto,
  type PortfolioSelectionNormalizationReason,
  type PortfolioSelectionNormalizationResult,
} from "@vakwen/shared-types";
import {
  ANALYSIS_MARKET_CODES,
  type AnalysisMarketCode,
} from "./unrealizedPnlTypes";
import {
  getPortfolioCapabilityOptionSets,
  normalizePortfolioReportingCurrencySelection,
} from "../portfolio-capabilities/portfolioCapabilities";

export interface AnalysisMarketNormalizationResult {
  requested: AnalysisMarketCode[];
  effective: AnalysisMarketCode[];
  reason: Extract<
    PortfolioSelectionNormalizationReason,
    "unconfigured_market" | "no_configured_markets"
  > | null;
}

export interface UnrealizedPnlCapabilityState {
  mode: "loading" | "zero" | "single" | "multiple";
  configuredMarkets: AnalysisMarketCode[];
  configuredCurrencies: AccountDefaultCurrency[];
  effectiveMarkets: AnalysisMarketCode[];
  effectiveReportingCurrency: AccountDefaultCurrency | null;
  marketNormalization: AnalysisMarketNormalizationResult | null;
  reportingCurrencyNormalization: PortfolioSelectionNormalizationResult<AccountDefaultCurrency> | null;
}

export function resolveUnrealizedPnlCapabilityState(
  capabilities: PortfolioCapabilitiesDto | null,
  requestedMarkets: AnalysisMarketCode[],
  requestedReportingCurrency: AccountDefaultCurrency,
): UnrealizedPnlCapabilityState {
  const canonicalRequestedMarkets = dedupeOrdered(requestedMarkets, ANALYSIS_MARKET_CODES);

  if (!capabilities) {
    return {
      mode: "loading",
      configuredMarkets: [...ANALYSIS_MARKET_CODES],
      configuredCurrencies: [...ACCOUNT_DEFAULT_CURRENCIES],
      effectiveMarkets: canonicalRequestedMarkets,
      effectiveReportingCurrency: requestedReportingCurrency,
      marketNormalization: null,
      reportingCurrencyNormalization: null,
    };
  }

  const optionSets = getPortfolioCapabilityOptionSets(capabilities);
  const configuredMarkets = dedupeOrdered(optionSets.configuredMarkets, ANALYSIS_MARKET_CODES);
  const configuredCurrencies = [...optionSets.configuredCurrencies];
  const mode = configuredMarkets.length === 0
    ? "zero"
    : configuredMarkets.length === 1
      ? "single"
      : "multiple";
  const marketNormalization = normalizeAnalysisMarketSelection(configuredMarkets, canonicalRequestedMarkets);
  const reportingCurrencyNormalization = normalizePortfolioReportingCurrencySelection(
    capabilities,
    requestedReportingCurrency,
  );

  return {
    mode,
    configuredMarkets,
    configuredCurrencies,
    effectiveMarkets: marketNormalization.effective,
    effectiveReportingCurrency: reportingCurrencyNormalization.effective,
    marketNormalization,
    reportingCurrencyNormalization,
  };
}

function normalizeAnalysisMarketSelection(
  configuredMarkets: AnalysisMarketCode[],
  requestedMarkets: AnalysisMarketCode[],
): AnalysisMarketNormalizationResult {
  if (configuredMarkets.length === 0) {
    return {
      requested: requestedMarkets,
      effective: [],
      reason: "no_configured_markets",
    };
  }

  if (requestedMarkets.length === 0) {
    return {
      requested: [],
      effective: [],
      reason: null,
    };
  }

  const effective = requestedMarkets.filter((market) => configuredMarkets.includes(market));
  if (effective.length === requestedMarkets.length) {
    return {
      requested: requestedMarkets,
      effective,
      reason: null,
    };
  }

  return {
    requested: requestedMarkets,
    effective,
    reason: "unconfigured_market",
  };
}

function dedupeOrdered<TSelection extends string>(
  values: readonly string[],
  allowed: readonly TSelection[],
): TSelection[] {
  const seen = new Set<TSelection>();
  const next: TSelection[] = [];

  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) continue;
    const typedValue = value as TSelection;
    if (seen.has(typedValue)) continue;
    seen.add(typedValue);
    next.push(typedValue);
  }

  return next;
}
