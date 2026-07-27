const CANONICAL_CURRENCIES = ["TWD", "USD", "AUD", "KRW", "JPY"] as const;
type CanonicalCurrency = typeof CANONICAL_CURRENCIES[number];
const MARKET_BY_CURRENCY = {
  TWD: "TW",
  USD: "US",
  AUD: "AU",
  KRW: "KR",
  JPY: "JP",
} as const;
type CanonicalMarket = (typeof MARKET_BY_CURRENCY)[CanonicalCurrency];

export interface PortfolioCapabilityAccountLike {
  /**
   * Caller responsibility: pass only active accounts. This helper is pure and
   * intentionally does not infer lifecycle state because the input shape has no
   * deleted marker.
   */
  defaultCurrency: string;
}

export interface DerivedPortfolioCapabilities {
  configuredMarkets: CanonicalMarket[];
  configuredCurrencies: CanonicalCurrency[];
}

export function derivePortfolioCapabilities(
  accounts: ReadonlyArray<PortfolioCapabilityAccountLike>,
): DerivedPortfolioCapabilities {
  const activeCurrencies = new Set(
    accounts.map((account) => account.defaultCurrency).filter(isCanonicalCurrency),
  );

  const configuredCurrencies = CANONICAL_CURRENCIES.filter((currency) => activeCurrencies.has(currency));
  const configuredMarkets = configuredCurrencies.map((currency) => MARKET_BY_CURRENCY[currency]);

  return {
    configuredMarkets: [...configuredMarkets],
    configuredCurrencies: [...configuredCurrencies],
  };
}

function isCanonicalCurrency(value: string): value is CanonicalCurrency {
  return (CANONICAL_CURRENCIES as readonly string[]).includes(value);
}
