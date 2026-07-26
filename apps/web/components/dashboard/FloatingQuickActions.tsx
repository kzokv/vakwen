"use client";

import { useState } from "react";
import {
  type AccountDefaultCurrency,
  type PortfolioCapabilitiesDto,
} from "@vakwen/shared-types";
import {
  CircleDollarSign,
  FileClock,
  Plus,
  ReceiptText,
  RefreshCw,
} from "lucide-react";
import { usePathname } from "next/navigation";
import type { AppDictionary } from "../../lib/i18n";
import { CapabilityNormalizationNotice } from "../../features/portfolio-capabilities/components/CapabilityNormalizationNotice";
import { SingleCapabilityContext } from "../../features/portfolio-capabilities/components/SingleCapabilityContext";
import { ZeroAccountSetupGate } from "../../features/portfolio-capabilities/components/ZeroAccountSetupGate";
import { useReportingCurrencyCapability } from "../../features/portfolio-capabilities/useReportingCurrencyCapability";
import { Button } from "../ui/Button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/shadcn/sheet";
import { useIsMobile } from "../../lib/hooks/use-mobile";

interface FloatingQuickActionsProps {
  hidden: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolioCapabilities: PortfolioCapabilitiesDto | null;
  isSharedContext: boolean;
  canManageAccounts: boolean;
  reportingCurrency: AccountDefaultCurrency;
  onReportingCurrencyChange: (
    currency: AccountDefaultCurrency,
    options?: { refreshRouter?: boolean },
  ) => Promise<void>;
  isReportingCurrencySaving: boolean;
  reportingCurrencyError: string;
  onAddTransaction: () => void;
  onRecompute: () => void;
  onGenerateSnapshots: () => void | Promise<void>;
  isGeneratingSnapshots: boolean;
  showRecomputeAction?: boolean;
  showGenerateSnapshotsAction?: boolean;
  dict: AppDictionary;
}

export function FloatingQuickActions({
  hidden,
  open,
  onOpenChange,
  portfolioCapabilities,
  isSharedContext,
  canManageAccounts,
  reportingCurrency,
  onReportingCurrencyChange,
  isReportingCurrencySaving,
  reportingCurrencyError,
  onAddTransaction,
  onRecompute,
  onGenerateSnapshots,
  isGeneratingSnapshots,
  showRecomputeAction = true,
  showGenerateSnapshotsAction = true,
  dict,
}: FloatingQuickActionsProps) {
  const isMobile = useIsMobile();
  const pathname = usePathname() ?? "/";
  const [currencySaved, setCurrencySaved] = useState(false);
  const {
    configuredCurrencies,
    effectiveReportingCurrency,
    normalization,
  } = useReportingCurrencyCapability({
    capabilities: portfolioCapabilities,
    reportingCurrency,
    isSharedContext,
    onNormalizeReportingCurrency: onReportingCurrencyChange,
  });

  if (hidden) return null;

  const close = () => onOpenChange(false);

  const handleCurrencyChange = async (value: string): Promise<void> => {
    if (!configuredCurrencies.includes(value as AccountDefaultCurrency)) return;
    setCurrencySaved(false);
    try {
      await onReportingCurrencyChange(value as AccountDefaultCurrency);
      setCurrencySaved(true);
    } catch {
      setCurrencySaved(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          className="fixed bottom-4 right-4 z-40 size-12 rounded-full p-0 shadow-lg sm:bottom-6 sm:right-6"
          aria-label={dict.commandPalette.quickActionsTitle}
          data-testid="floating-quick-actions-trigger"
        >
          <Plus aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        data-testid="floating-quick-actions-sheet"
        className="flex flex-col gap-3"
      >
        <SheetHeader>
          <SheetTitle>{dict.commandPalette.quickActionsTitle}</SheetTitle>
          <SheetDescription>{dict.commandPalette.quickActionsDescription}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CircleDollarSign data-icon="inline-start" aria-hidden="true" />
            {dict.commandPalette.actionChangeReportingCurrency}
          </div>
          {portfolioCapabilities && configuredCurrencies.length === 0 ? (
            <ZeroAccountSetupGate
              dict={dict}
              canManageAccounts={canManageAccounts}
              returnTo={pathname}
            />
          ) : configuredCurrencies.length === 1 ? (
            <SingleCapabilityContext
              label={dict.commandPalette.actionChangeReportingCurrency}
              value={effectiveReportingCurrency ?? reportingCurrency}
              testId="floating-action-reporting-currency-single"
            />
          ) : (
            <Select
              value={effectiveReportingCurrency ?? reportingCurrency}
              onValueChange={(value) => { void handleCurrencyChange(value); }}
              disabled={isReportingCurrencySaving}
            >
              <SelectTrigger data-testid="floating-action-reporting-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {configuredCurrencies.map((currency) => (
                    <SelectItem key={currency} value={currency}>
                      {currency}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          {normalization ? (
            <CapabilityNormalizationNotice
              dict={dict}
              kind="reportingCurrency"
              normalization={normalization}
            />
          ) : null}
          {currencySaved ? (
            <p className="text-xs text-muted-foreground">
              {dict.commandPalette.actionReportingCurrencySaved}
            </p>
          ) : null}
          {reportingCurrencyError ? (
            <p className="text-xs text-destructive" role="alert">
              {reportingCurrencyError}
            </p>
          ) : null}
        </div>

        <Button
          variant="default"
          className="w-full justify-start"
          onClick={() => {
            close();
            onAddTransaction();
          }}
          data-testid="floating-action-add-transaction"
        >
          <ReceiptText data-icon="inline-start" aria-hidden="true" />
          {dict.commandPalette.actionAddTransaction}
        </Button>
        {showRecomputeAction ? (
          <Button
            variant="secondary"
            className="w-full justify-start"
            onClick={() => {
              close();
              onRecompute();
            }}
            data-testid="floating-action-recompute"
          >
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            {dict.commandPalette.actionRecomputeAll}
          </Button>
        ) : null}
        {showGenerateSnapshotsAction ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              className="w-full justify-start"
              disabled={isGeneratingSnapshots}
              onClick={() => {
                close();
                void onGenerateSnapshots();
              }}
              data-testid="floating-action-generate-snapshots"
            >
              <FileClock data-icon="inline-start" aria-hidden="true" />
              {dict.commandPalette.actionGenerateSnapshots}
            </Button>
            <p className="px-1 text-xs text-muted-foreground" data-testid="floating-action-generate-snapshots-hint">
              {dict.commandPalette.actionGenerateSnapshotsHint}
            </p>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
