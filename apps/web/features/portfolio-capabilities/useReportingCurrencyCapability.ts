"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  AccountDefaultCurrency,
  PortfolioCapabilitiesDto,
  PortfolioSelectionNormalizationResult,
} from "@vakwen/shared-types";
import {
  getPortfolioCapabilityOptionSets,
  normalizePortfolioReportingCurrencySelection,
} from "./portfolioCapabilities";

interface NormalizeReportingCurrencyOptions {
  refreshRouter?: boolean;
}

interface UseReportingCurrencyCapabilityOptions {
  capabilities: PortfolioCapabilitiesDto | null;
  reportingCurrency: AccountDefaultCurrency;
  isSharedContext: boolean;
  onNormalizeReportingCurrency: (
    currency: AccountDefaultCurrency,
    options?: NormalizeReportingCurrencyOptions,
  ) => Promise<void>;
}

export interface ReportingCurrencyCapabilityState {
  configuredCurrencies: AccountDefaultCurrency[];
  effectiveReportingCurrency: AccountDefaultCurrency | null;
  normalization: PortfolioSelectionNormalizationResult<AccountDefaultCurrency> | null;
}

export function useReportingCurrencyCapability({
  capabilities,
  reportingCurrency,
  isSharedContext,
  onNormalizeReportingCurrency,
}: UseReportingCurrencyCapabilityOptions): ReportingCurrencyCapabilityState {
  const normalizationAttemptRef = useRef<string | null>(null);

  const state = useMemo<ReportingCurrencyCapabilityState>(() => {
    if (!capabilities) {
      return {
        configuredCurrencies: [reportingCurrency],
        effectiveReportingCurrency: reportingCurrency,
        normalization: null,
      };
    }

    const { configuredCurrencies } = getPortfolioCapabilityOptionSets(capabilities);
    const normalization = normalizePortfolioReportingCurrencySelection(capabilities, reportingCurrency);

    return {
      configuredCurrencies,
      effectiveReportingCurrency: normalization.effective,
      normalization,
    };
  }, [capabilities, reportingCurrency]);

  useEffect(() => {
    if (!capabilities || isSharedContext) {
      normalizationAttemptRef.current = null;
      return;
    }

    if (state.normalization?.reason !== "unconfigured_currency") {
      normalizationAttemptRef.current = null;
      return;
    }

    const nextCurrency = state.normalization.effective;
    if (!nextCurrency || nextCurrency === reportingCurrency) {
      normalizationAttemptRef.current = null;
      return;
    }

    const attemptKey = `${reportingCurrency}->${nextCurrency}`;
    if (normalizationAttemptRef.current === attemptKey) {
      return;
    }

    normalizationAttemptRef.current = attemptKey;
    void onNormalizeReportingCurrency(nextCurrency, { refreshRouter: false }).catch(() => {
      if (normalizationAttemptRef.current === attemptKey) {
        normalizationAttemptRef.current = null;
      }
    });
  }, [capabilities, isSharedContext, onNormalizeReportingCurrency, reportingCurrency, state.normalization]);

  return state;
}
