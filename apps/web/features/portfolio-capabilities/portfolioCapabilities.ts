import {
  ACCOUNT_DEFAULT_CURRENCIES,
  MARKET_CODES,
  type AccountDefaultCurrency,
  type MarketCode,
  type PortfolioCapabilitiesDto,
  type PortfolioSelectionNormalizationReason,
  type PortfolioSelectionNormalizationResult,
  type ReportScope,
} from "@vakwen/shared-types";

export interface PortfolioCapabilityOptionSets {
  configuredMarkets: MarketCode[];
  configuredReportScopes: ReportScope[];
  configuredCurrencies: AccountDefaultCurrency[];
}

export function getPortfolioCapabilityOptionSets(
  capabilities: PortfolioCapabilitiesDto,
): PortfolioCapabilityOptionSets {
  const configuredMarkets = dedupeOrderedValues(capabilities.configuredMarkets, MARKET_CODES);
  const configuredCurrencies = dedupeOrderedValues(capabilities.configuredCurrencies, ACCOUNT_DEFAULT_CURRENCIES);

  return {
    configuredMarkets,
    configuredReportScopes: buildConfiguredReportScopes(configuredMarkets),
    configuredCurrencies,
  };
}

export function normalizePortfolioMarketSelection(
  capabilities: PortfolioCapabilitiesDto,
  requested: MarketCode | null | undefined,
): PortfolioSelectionNormalizationResult<MarketCode> {
  const { configuredMarkets } = getPortfolioCapabilityOptionSets(capabilities);
  return normalizeSingleSelection(configuredMarkets, requested, "unconfigured_market", "no_configured_markets");
}

export function normalizePortfolioReportScopeSelection(
  capabilities: PortfolioCapabilitiesDto,
  requested: ReportScope | null | undefined,
): PortfolioSelectionNormalizationResult<ReportScope> {
  const { configuredMarkets } = getPortfolioCapabilityOptionSets(capabilities);

  if (configuredMarkets.length === 0) {
    return {
      requested: requested ?? null,
      effective: null,
      reason: "no_configured_markets",
    };
  }

  const fallback = defaultReportScope(configuredMarkets);
  if (!fallback) {
    return {
      requested: requested ?? null,
      effective: null,
      reason: "no_configured_markets",
    };
  }

  if (requested == null) {
    return {
      requested: null,
      effective: fallback,
      reason: null,
    };
  }

  if (requested === "all") {
    return {
      requested,
      effective: fallback,
      reason: null,
    };
  }

  if (configuredMarkets.includes(requested)) {
    return {
      requested,
      effective: requested,
      reason: null,
    };
  }

  return {
    requested,
    effective: fallback,
    reason: "unconfigured_market",
  };
}

export function normalizePortfolioReportingCurrencySelection(
  capabilities: PortfolioCapabilitiesDto,
  requested: AccountDefaultCurrency | null | undefined,
): PortfolioSelectionNormalizationResult<AccountDefaultCurrency> {
  const { configuredCurrencies } = getPortfolioCapabilityOptionSets(capabilities);
  return normalizeSingleSelection(
    configuredCurrencies,
    requested,
    "unconfigured_currency",
    "no_configured_currencies",
  );
}

export function normalizeCapabilityReturnTo(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return null;
  }
  try {
    const url = new URL(trimmed, "http://n");
    return url.host === "n" ? trimmed : null;
  } catch {
    return null;
  }
}

export function buildAccountsSetupHref(returnTo: string | null | undefined): string {
  const normalizedReturnTo = normalizeCapabilityReturnTo(returnTo);
  if (!normalizedReturnTo) {
    return "/settings/accounts";
  }

  const params = new URLSearchParams({ returnTo: normalizedReturnTo });
  return `/settings/accounts?${params.toString()}`;
}

function buildConfiguredReportScopes(markets: readonly MarketCode[]): ReportScope[] {
  if (markets.length === 0) return [];
  if (markets.length === 1) return [markets[0]];
  return ["all", ...markets];
}

function defaultReportScope(markets: readonly MarketCode[]): ReportScope | null {
  if (markets.length === 0) return null;
  if (markets.length === 1) return markets[0];
  return "all";
}

function normalizeSingleSelection<TSelection extends string>(
  options: readonly TSelection[],
  requested: TSelection | null | undefined,
  staleReason: Extract<
    PortfolioSelectionNormalizationReason,
    "unconfigured_market" | "unconfigured_currency"
  >,
  emptyReason: Extract<
    PortfolioSelectionNormalizationReason,
    "no_configured_markets" | "no_configured_currencies"
  >,
): PortfolioSelectionNormalizationResult<TSelection> {
  if (options.length === 0) {
    return {
      requested: requested ?? null,
      effective: null,
      reason: emptyReason,
    };
  }

  const fallback = options[0] ?? null;
  if (!fallback) {
    return {
      requested: requested ?? null,
      effective: null,
      reason: emptyReason,
    };
  }

  if (requested == null) {
    return {
      requested: null,
      effective: fallback,
      reason: null,
    };
  }

  if (options.includes(requested)) {
    return {
      requested,
      effective: requested,
      reason: null,
    };
  }

  return {
    requested,
    effective: fallback,
    reason: staleReason,
  };
}

function dedupeOrderedValues<TSelection extends string>(
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
