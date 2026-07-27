"use client";

import { useRouter } from "next/navigation";
import type { AppDictionary } from "../../../lib/i18n/types";
import { Button } from "../../../components/ui/Button";
import { buildAccountsSetupHref } from "../portfolioCapabilities";

interface ZeroAccountSetupGateProps {
  dict: AppDictionary;
  canManageAccounts: boolean;
  returnTo?: string | null;
}

export function ZeroAccountSetupGate({
  dict,
  canManageAccounts,
  returnTo = null,
}: ZeroAccountSetupGateProps) {
  const router = useRouter();
  const copy = dict.portfolioCapabilities;
  const href = buildAccountsSetupHref(returnTo);

  return (
    <section
      className="rounded-2xl border border-dashed border-border/80 bg-muted/20 px-5 py-4"
      data-testid="portfolio-capabilities-zero-account-gate"
      aria-live="polite"
    >
      <h2 className="text-base font-semibold text-foreground">{copy.zeroAccountGateTitle}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {canManageAccounts ? copy.zeroAccountGateDescription : copy.zeroAccountGateReadonly}
      </p>
      {canManageAccounts ? (
        <Button
          className="mt-4"
          data-testid="portfolio-capabilities-zero-account-cta"
          onClick={() => router.replace(href, { scroll: false })}
        >
          {copy.zeroAccountGateAction}
        </Button>
      ) : (
        <p
          className="mt-4 text-sm font-medium text-muted-foreground"
          data-testid="portfolio-capabilities-zero-account-readonly"
          role="status"
        >
          {copy.zeroAccountGateReadonly}
        </p>
      )}
    </section>
  );
}
