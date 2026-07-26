"use client";

// Phase 5a — Tabs container that merges /dividends + /dividends/review into
// one route. Tab axis is driven by ?view= query param:
//   - view absent  → calendar (default)
//   - view=calendar → calendar
//   - view=ledger  → ledger
//   - any ledger-only param (status, sortBy, etc.) without explicit view= →
//     ledger (implied per scope-grill Phase 5 lock #2)
//
// URL sync uses router.replace + window.history.replaceState pair per
// .claude/rules/playwright-navigation-patterns.md so E2E page.url()
// assertions update synchronously.
//
// Tab switch from ledger → calendar drops ledger-only params (the calendar
// has its own date-range axis via month picker).

import { useCallback, useEffect, useState } from "react";
import type {
  DividendReviewAccountOptionDto,
  DividendReviewPrimaryDto,
  DividendReviewPrimaryQueryDto,
  LocaleCode,
} from "@vakwen/shared-types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/shadcn/tabs";
import type { AppDictionary } from "../../lib/i18n";
import {
  calendarMonthFromSearchParams,
  monthQuery,
  searchParamsToReviewQuery,
} from "./dividendsPageQuery";
import { DividendCalendarClient, type DividendDailyHighlightsState } from "./DividendCalendarClient";
import { DividendReviewClient } from "./DividendReviewClient";
import {
  DIVIDENDS_LEDGER_ONLY_PARAMS as LEDGER_ONLY_PARAMS,
  type DividendsTabValue,
} from "./dividendsTabsUtils";
import {
  fetchDividendCalendarSnapshot,
} from "../../features/dividends/services/dividendService";
import type { DividendCalendarSnapshot } from "../../features/dividends/types";
import { useOptionalAppShellData } from "../layout/AppShellDataContext";
import { ZeroAccountSetupGate } from "../../features/portfolio-capabilities/components/ZeroAccountSetupGate";

interface DividendsTabsClientProps {
  initialTab: DividendsTabValue;
  calendarLabel: string;
  ledgerLabel: string;
  dict: AppDictionary;
  locale: LocaleCode;
  accounts: DividendReviewAccountOptionDto[];
  initialCalendarMonth: string;
  initialCalendarSnapshot: DividendCalendarSnapshot | null;
  initialDailyHighlights?: DividendDailyHighlightsState;
  initialContextOwnerId?: string | null;
  initialReviewData: DividendReviewPrimaryDto | null;
  initialReviewQuery?: DividendReviewPrimaryQueryDto;
  initialYears: number[];
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div
      className="rounded-[24px] border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground shadow-sm"
      data-testid="dividends-tab-loading"
    >
      Loading {label.toLowerCase()}...
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      className="rounded-[24px] border border-destructive/30 bg-destructive/5 px-5 py-10 text-center text-sm text-destructive shadow-sm"
      data-testid="dividends-tab-error"
      role="status"
    >
      {message}
    </div>
  );
}

export function buildOverviewTabUrl(search: string): { month: string; url: string } {
  const params = new URLSearchParams(search);
  for (const key of LEDGER_ONLY_PARAMS) params.delete(key);
  params.delete("view");
  const month = calendarMonthFromSearchParams(params);
  params.set("month", month);
  const qs = params.toString();
  return { month, url: qs ? `/dividends?${qs}` : "/dividends" };
}

export function DividendsTabsClient({
  initialTab,
  calendarLabel,
  ledgerLabel,
  dict,
  locale,
  accounts,
  initialCalendarMonth,
  initialCalendarSnapshot,
  initialDailyHighlights,
  initialContextOwnerId,
  initialReviewData,
  initialReviewQuery = searchParamsToReviewQuery(new URLSearchParams()),
  initialYears,
}: DividendsTabsClientProps) {
  const shellData = useOptionalAppShellData();
  const [activeTab, setActiveTab] = useState<DividendsTabValue>(initialTab);
  const [reviewQuery, setReviewQuery] = useState(initialReviewQuery);
  const [calendarMonth, setCalendarMonth] = useState(initialCalendarMonth);
  const [calendarSnapshot, setCalendarSnapshot] = useState<DividendCalendarSnapshot | null>(initialCalendarSnapshot);
  const [calendarSnapshotMonth, setCalendarSnapshotMonth] = useState<string | null>(
    initialCalendarSnapshot ? initialCalendarMonth : null,
  );
  const [isCalendarLoading, setIsCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const orderedTabs = [
    { value: "calendar" as const, label: calendarLabel, testId: "dividends-tab-calendar" },
    { value: "ledger" as const, label: ledgerLabel, testId: "dividends-tab-ledger" },
  ];
  const reviewSeedMatchesQuery = JSON.stringify(reviewQuery) === JSON.stringify(initialReviewQuery);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setCalendarMonth(initialCalendarMonth);
    setCalendarSnapshot(initialCalendarSnapshot);
    setCalendarSnapshotMonth(initialCalendarSnapshot ? initialCalendarMonth : null);
  }, [initialCalendarMonth, initialCalendarSnapshot]);


  const handleTabChange = useCallback(
    (next: string) => {
      const value = next as DividendsTabValue;
      const params = new URLSearchParams(window.location.search);
      let url: string;

      if (value === "calendar") {
        const nextOverview = buildOverviewTabUrl(window.location.search);
        setCalendarMonth(nextOverview.month);
        if (calendarSnapshotMonth !== nextOverview.month) {
          setCalendarSnapshot(null);
          setCalendarSnapshotMonth(null);
        }
        url = nextOverview.url;
      } else {
        params.set("view", "ledger");
        setReviewQuery(searchParamsToReviewQuery(params));
        const qs = params.toString();
        url = qs ? `/dividends?${qs}` : "/dividends";
      }

      window.history.replaceState(null, "", url);
      setActiveTab(value);
    },
    [calendarSnapshotMonth],
  );

  useEffect(() => {
    if (activeTab !== "calendar" || calendarSnapshot) return;

    let cancelled = false;
    setCalendarError("");
    setIsCalendarLoading(true);
    void fetchDividendCalendarSnapshot(monthQuery(calendarMonth))
      .then((snapshot) => {
        if (!cancelled) {
          setCalendarSnapshot(snapshot);
          setCalendarSnapshotMonth(calendarMonth);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCalendarError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCalendarLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, calendarMonth, calendarSnapshot]);

  if (
    shellData
    && !shellData.isPortfolioConfigLoading
    && shellData.portfolioCapabilities?.configuredCurrencies.length === 0
  ) {
    return (
      <ZeroAccountSetupGate
        dict={dict}
        canManageAccounts={
          !shellData.isSharedContext
          || shellData.sharedContextPermissions.canManageAccounts
        }
        returnTo="/dividends"
      />
    );
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      data-testid="dividends-tabs"
      className="flex flex-col gap-4"
    >
      <TabsList className="self-start">
        {orderedTabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} data-testid={tab.testId}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* forceMount-equivalent: only mount the active slot so heavy
          components (DividendReviewClient with SSR data) don't render
          when not needed. The Tabs value drives which slot is in DOM. */}
      <TabsContent value="calendar" data-testid="dividends-tabpanel-calendar">
        {calendarSnapshot ? (
          <DividendCalendarClient
            initialSnapshot={calendarSnapshot}
            initialMonth={calendarMonth}
            initialDailyHighlights={initialDailyHighlights}
            initialContextOwnerId={initialContextOwnerId}
            dict={dict}
            locale={locale}
            onSnapshotChange={(nextSnapshot, nextMonth) => {
              setCalendarMonth(nextMonth);
              setCalendarSnapshot(nextSnapshot);
              setCalendarSnapshotMonth(nextMonth);
            }}
          />
        ) : isCalendarLoading ? (
          <LoadingPanel label={calendarLabel} />
        ) : calendarError ? (
          <ErrorPanel message={calendarError} />
        ) : null}
      </TabsContent>
      <TabsContent value="ledger" data-testid="dividends-tabpanel-ledger">
        <DividendReviewClient
          initialData={reviewSeedMatchesQuery ? initialReviewData : null}
          initialQuery={reviewQuery}
          dict={dict}
          locale={locale}
          accounts={initialReviewData?.accounts ?? accounts}
          years={initialReviewData?.years ?? initialYears}
        />
      </TabsContent>
    </Tabs>
  );
}
