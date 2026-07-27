"use client";

import { useState } from "react";
import type { PortfolioSelectionNormalizationReason } from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n/types";
import { Button } from "../../../components/ui/Button";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/shadcn/alert";

type NoticeKind = "market" | "reportScope" | "reportingCurrency";
interface CapabilityNormalizationNoticeProps {
  dict: AppDictionary;
  kind: NoticeKind;
  normalization: {
    requested: unknown;
    effective: unknown;
    reason: PortfolioSelectionNormalizationReason | null;
  };
  effectiveLabel?: string | null;
}

export function CapabilityNormalizationNotice({
  dict,
  kind,
  normalization,
  effectiveLabel,
}: CapabilityNormalizationNoticeProps) {
  const [dismissed, setDismissed] = useState(false);
  const testId = `portfolio-capabilities-normalization-notice-${kind}`;
  const dismissTestId = `portfolio-capabilities-normalization-dismiss-${kind}`;

  if (dismissed || normalization.reason == null) {
    return null;
  }

  const copy = dict.portfolioCapabilities;
  const normalizedEffectiveLabel = typeof normalization.effective === "string"
    ? normalization.effective
    : Array.isArray(normalization.effective)
      ? normalization.effective.join(", ")
      : null;
  const description = describeNormalization(
    copy,
    kind,
    normalization.reason,
    effectiveLabel ?? normalizedEffectiveLabel,
  );

  return (
    <Alert data-testid={testId} aria-live="polite" className="items-start gap-3">
      <div className="flex-1">
        <AlertTitle>{copy.normalizationNoticeTitle}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={copy.dismissNormalizationNotice}
        data-testid={dismissTestId}
        onClick={() => setDismissed(true)}
      >
        {dict.actions.dismiss}
      </Button>
    </Alert>
  );
}

function describeNormalization(
  copy: AppDictionary["portfolioCapabilities"],
  kind: NoticeKind,
  reason: string,
  effectiveLabel: string | null,
): string {
  if (reason === "no_configured_markets") {
    return copy.noConfiguredMarkets;
  }
  if (reason === "no_configured_currencies") {
    return copy.noConfiguredCurrencies;
  }

  const fallback = effectiveLabel ?? copy.noneAvailable;
  if (reason === "unconfigured_market" && kind === "reportScope") {
    return copy.unconfiguredReportScope.replace("{value}", fallback);
  }
  if (reason === "unconfigured_market") {
    return copy.unconfiguredMarket.replace("{value}", fallback);
  }
  return copy.unconfiguredCurrency.replace("{value}", fallback);
}
