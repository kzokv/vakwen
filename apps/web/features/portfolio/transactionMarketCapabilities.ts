"use client";

import { MARKET_CODES, type MarketCode, type PortfolioCapabilitiesDto } from "@vakwen/shared-types";
import type { PortfolioSelectionNormalizationResult } from "@vakwen/shared-types";
import {
  getPortfolioCapabilityOptionSets,
  normalizePortfolioMarketSelection,
} from "../portfolio-capabilities/portfolioCapabilities";
import type { TransactionHistoryMarketFilter } from "./transactionHistoryRouteState";

export interface TransactionMarketCapabilityState {
  configuredMarkets: MarketCode[];
  filterMarketCode: TransactionHistoryMarketFilter;
  normalization: PortfolioSelectionNormalizationResult<MarketCode> | null;
}

export function resolveTransactionMarketCapabilityState(
  capabilities: PortfolioCapabilitiesDto | null,
  requestedMarketCode: TransactionHistoryMarketFilter,
): TransactionMarketCapabilityState {
  if (!capabilities) {
    return {
      configuredMarkets: [...MARKET_CODES],
      filterMarketCode: requestedMarketCode,
      normalization: null,
    };
  }

  const { configuredMarkets } = getPortfolioCapabilityOptionSets(capabilities);
  if (configuredMarkets.length === 0) {
    return {
      configuredMarkets,
      filterMarketCode: "ALL",
      normalization: requestedMarketCode === "ALL"
        ? null
        : {
            requested: requestedMarketCode,
            effective: null,
            reason: "no_configured_markets",
          },
    };
  }

  if (requestedMarketCode === "ALL") {
    return {
      configuredMarkets,
      filterMarketCode: "ALL",
      normalization: null,
    };
  }

  const normalization = normalizePortfolioMarketSelection(capabilities, requestedMarketCode);
  return {
    configuredMarkets,
    filterMarketCode: normalization.reason == null
      ? requestedMarketCode
      : (normalization.effective ?? configuredMarkets[0] ?? "ALL"),
    normalization,
  };
}
