"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { HslColorPicker } from "react-colorful";
import type {
  AccentPreset,
  AccountDefaultCurrency,
  DensityMode,
  PriceColorConvention,
  ThemeAccent,
} from "@vakwen/shared-types";
import {
  ACCENT_PRESETS,
  DEFAULT_PRICE_COLOR_CONVENTION,
  DEFAULT_THEME_ACCENT,
  PRICE_COLOR_CONVENTIONS,
  densityModeSchema,
  priceColorConventionSchema,
  themeAccentSchema,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { ApiError, getJson, patchJson } from "../../lib/api";
import {
  aaContrastPassesBothModes,
  applyAccent,
  applyDensity,
  applyPriceColorConvention,
  hexToHsl,
  hslToHex,
} from "../../lib/theme";
import { cn } from "../../lib/utils";
import { CapabilityNormalizationNotice } from "../../features/portfolio-capabilities/components/CapabilityNormalizationNotice";
import { SingleCapabilityContext } from "../../features/portfolio-capabilities/components/SingleCapabilityContext";
import { ZeroAccountSetupGate } from "../../features/portfolio-capabilities/components/ZeroAccountSetupGate";
import { useReportingCurrencyCapability } from "../../features/portfolio-capabilities/useReportingCurrencyCapability";
import { useAppShellData } from "../layout/AppShellDataContext";
import { Button } from "../ui/Button";
import { CustomizeRangesPopover } from "./CustomizeRangesPopover";

const PRESET_PREVIEW: Record<AccentPreset, string> = {
  indigo: "hsl(238 84% 60%)",
  violet: "hsl(262 83% 58%)",
  blue: "hsl(217 91% 60%)",
  cyan: "hsl(188 86% 38%)",
  emerald: "hsl(158 64% 40%)",
  amber: "hsl(35 92% 50%)",
  rose: "hsl(347 77% 50%)",
  slate: "hsl(222 47% 11%)",
};

/**
 * KZO-161 — Settings drawer "Display" tab body (design §9).
 * KZO-162 — Layout section grew from 1 to 4 always-visible reset buttons:
 * three per-page resets (dashboard / transactions / portfolio) plus a
 * global "Reset all layouts" button. Per-page resets PATCH per-key null;
 * the global reset PATCHes `cardOrder: null`.
 * KZO-180 — Reporting currency selector. Immediate save on change; mirrors
 * the `runReset` flash pattern in this same tab (not the
 * `CustomizeRangesPopover` save-button flow). When the PATCH succeeds,
 * fires `onReportingCurrencySaved` so AppShell can refetch
 * `/dashboard/overview` + `/dashboard/performance` with the new currency.
 */

export type ReorderablePage = "dashboard" | "transactions" | "portfolio";

interface UserPreferencesResponse {
  preferences?: {
    themeAccent?: unknown;
    density?: unknown;
    priceColorConvention?: unknown;
  } | null;
}

export interface DisplayTabSectionProps {
  dict: AppDictionary;
  /** Called after a successful timeframe save so AppShell refetches effective ranges. */
  onTimeframesSaved: () => void;
  /** Called after a successful global "Reset all layouts" PATCH. */
  onLayoutReset: () => void;
  /** Called after a successful per-page reset PATCH (KZO-162). */
  onPageLayoutReset: (page: ReorderablePage) => void;
  /**
   * KZO-180 — called after a successful reporting-currency PATCH so AppShell
   * can refetch `/dashboard/overview` + `/dashboard/performance` with the new
   * currency. Default no-op (mirrors the layout-reset callbacks).
   */
  onReportingCurrencySaved?: () => void;
}

const SAVED_FLASH_MS = 1800;

export function DisplayTabSection({
  dict,
  onTimeframesSaved,
  onLayoutReset,
  onPageLayoutReset,
  onReportingCurrencySaved,
}: DisplayTabSectionProps): JSX.Element {
  const pathname = usePathname() ?? "/settings/display";
  const shellData = useAppShellData();
  const [resetting, setResetting] = useState<ReorderablePage | "all" | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const [currencySavedFlash, setCurrencySavedFlash] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [priceColorConvention, setPriceColorConvention] = useState<PriceColorConvention>(DEFAULT_PRICE_COLOR_CONVENTION);
  const [priceColorSaving, setPriceColorSaving] = useState(false);
  const [priceColorSavedFlash, setPriceColorSavedFlash] = useState(false);
  const [priceColorError, setPriceColorError] = useState<string | null>(null);
  const priceColorFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 2C — accent + density state.
  const [accent, setAccent] = useState<ThemeAccent>(DEFAULT_THEME_ACCENT);
  const [density, setDensity] = useState<DensityMode>("compact");
  const [customOpen, setCustomOpen] = useState(false);
  // Live-edit values for the custom picker (not yet persisted).
  const [customDraft, setCustomDraft] = useState<{ h: number; s: number; l: number }>({
    h: 238,
    s: 84,
    l: 60,
  });
  const { resolvedTheme } = useTheme();
  const canManageAccounts = !shellData.isSharedContext || shellData.sharedContextPermissions.canManageAccounts;
  const {
    configuredCurrencies,
    effectiveReportingCurrency,
    normalization,
  } = useReportingCurrencyCapability({
    capabilities: shellData.portfolioCapabilities,
    reportingCurrency: shellData.reportingCurrency,
    isSharedContext: shellData.isSharedContext,
    onNormalizeReportingCurrency: shellData.saveReportingCurrency,
  });

  // Initial hydration from GET /user-preferences (once per mount).
  useEffect(() => {
    let cancelled = false;
    void getJson<UserPreferencesResponse>("/user-preferences", { contextScope: "session" })
      .then((res) => {
        if (cancelled) return;
        // Phase 2C — hydrate accent + density from the same response.
        const savedAccent = themeAccentSchema.safeParse(res?.preferences?.themeAccent);
        if (savedAccent.success) {
          setAccent(savedAccent.data);
          if (savedAccent.data.kind === "custom") {
            setCustomDraft({
              h: savedAccent.data.h,
              s: savedAccent.data.s,
              l: savedAccent.data.l,
            });
          }
        }
        const savedDensity = densityModeSchema.safeParse(res?.preferences?.density);
        if (savedDensity.success) setDensity(savedDensity.data);
        const savedPriceColorConvention = priceColorConventionSchema.safeParse(res?.preferences?.priceColorConvention);
        if (savedPriceColorConvention.success) {
          setPriceColorConvention(savedPriceColorConvention.data);
          applyPriceColorConvention(savedPriceColorConvention.data);
        }
      })
      .catch(() => {
        // Silent fallback: "TWD" default stays in state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Clean up the flash timer on unmount.
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (priceColorFlashTimerRef.current) clearTimeout(priceColorFlashTimerRef.current);
    };
  }, []);

  const runReset = useCallback(
    async (target: ReorderablePage | "all"): Promise<void> => {
      setResetting(target);
      setResetMessage(null);
      setResetError(null);
      try {
        if (target === "all") {
          await patchJson("/user-preferences", { cardOrder: null }, { contextScope: "session" });
          onLayoutReset();
        } else {
          await patchJson("/user-preferences", { cardOrder: { [target]: null } }, { contextScope: "session" });
          onPageLayoutReset(target);
        }
        setResetMessage(dict.settings.resetLayoutSuccess);
      } catch (err) {
        if (err instanceof ApiError) setResetError(err.message);
        else if (err instanceof Error) setResetError(err.message);
        else setResetError(dict.settings.resetLayoutError);
      } finally {
        setResetting(null);
      }
    },
    [
      dict.settings.resetLayoutSuccess,
      dict.settings.resetLayoutError,
      onLayoutReset,
      onPageLayoutReset,
    ],
  );

  const handleReportingCurrencyChange = useCallback(
    async (next: AccountDefaultCurrency): Promise<void> => {
      setCurrencySavedFlash(false);
      try {
        await shellData.saveReportingCurrency(next);
        setCurrencySavedFlash(true);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(
          () => setCurrencySavedFlash(false),
          SAVED_FLASH_MS,
        );
        onReportingCurrencySaved?.();
      } catch {
        // AppShell owns the persisted error state shown by this section.
      }
    },
    [
      shellData,
      onReportingCurrencySaved,
    ],
  );

  // Phase 2C — accent + density change handlers. Optimistic update + apply
  // to <html> on success; roll back on PATCH failure.
  const saveAccent = useCallback(
    async (next: ThemeAccent): Promise<void> => {
      const previous = accent;
      setAccent(next);
      applyAccent(next, resolvedTheme === "dark" ? "dark" : "light");
      try {
        await patchJson("/user-preferences", { themeAccent: next }, { contextScope: "session" });
      } catch {
        setAccent(previous);
        applyAccent(previous, resolvedTheme === "dark" ? "dark" : "light");
      }
    },
    [accent, resolvedTheme],
  );

  const saveDensity = useCallback(
    async (next: DensityMode): Promise<void> => {
      const previous = density;
      setDensity(next);
      applyDensity(next);
      try {
        await patchJson("/user-preferences", { density: next }, { contextScope: "session" });
      } catch {
        setDensity(previous);
        applyDensity(previous);
      }
    },
    [density],
  );

  const savePriceColorConvention = useCallback(
    async (next: PriceColorConvention): Promise<void> => {
      const previous = priceColorConvention;
      setPriceColorConvention(next);
      applyPriceColorConvention(next);
      setPriceColorSaving(true);
      setPriceColorError(null);
      setPriceColorSavedFlash(false);
      try {
        await patchJson("/user-preferences", { priceColorConvention: next }, { contextScope: "session" });
        setPriceColorSavedFlash(true);
        if (priceColorFlashTimerRef.current) clearTimeout(priceColorFlashTimerRef.current);
        priceColorFlashTimerRef.current = setTimeout(
          () => setPriceColorSavedFlash(false),
          SAVED_FLASH_MS,
        );
      } catch (err) {
        setPriceColorConvention(previous);
        applyPriceColorConvention(previous);
        if (err instanceof ApiError) setPriceColorError(err.message);
        else if (err instanceof Error) setPriceColorError(err.message);
        else setPriceColorError(dict.settings.resetLayoutError);
      } finally {
        setPriceColorSaving(false);
      }
    },
    [
      priceColorConvention,
      dict.settings.resetLayoutError,
    ],
  );

  const customDraftAccent: ThemeAccent = {
    kind: "custom",
    h: customDraft.h,
    s: customDraft.s,
    l: customDraft.l,
  };
  const customPassesAA = aaContrastPassesBothModes(customDraftAccent);

  return (
    <div className="space-y-6" data-testid="display-tab-content">
      {/* Phase 2C — Accent color picker. 8 presets + custom wheel.            */}
      <section
        className="space-y-3 rounded-xl border border-slate-200 bg-white/90 p-4"
        data-testid="display-accent-section"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {dict.settings.displayAccentTitle}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {dict.settings.displayAccentDescription}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {ACCENT_PRESETS.map((preset) => {
            const on = accent.kind === "preset" && accent.preset === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-label={preset}
                aria-pressed={on}
                title={preset}
                onClick={() => {
                  setCustomOpen(false);
                  void saveAccent({ kind: "preset", preset });
                }}
                data-testid={`display-accent-swatch-${preset}`}
                className={cn(
                  "relative h-9 w-9 rounded-lg border-2 transition",
                  on ? "border-slate-900" : "border-transparent hover:scale-105",
                )}
                style={{ background: PRESET_PREVIEW[preset] }}
              >
                {on ? (
                  <span className="absolute inset-0 grid place-items-center text-sm font-bold text-white drop-shadow-sm">
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            aria-label={dict.settings.displayAccentCustom}
            aria-pressed={accent.kind === "custom"}
            title={dict.settings.displayAccentCustom}
            onClick={() => setCustomOpen((v) => !v)}
            data-testid="display-accent-swatch-custom"
            className={cn(
              "relative h-9 w-9 rounded-lg border-2 transition",
              accent.kind === "custom" ? "border-slate-900" : "border-transparent hover:scale-105",
            )}
            style={{
              background:
                "conic-gradient(from 0deg, hsl(0 90% 55%), hsl(60 90% 55%), hsl(120 90% 45%), hsl(180 90% 45%), hsl(240 90% 60%), hsl(300 90% 55%), hsl(0 90% 55%))",
            }}
          >
            <span className="absolute inset-0 grid place-items-center text-base font-bold text-white drop-shadow-sm">
              {accent.kind === "custom" ? "✓" : "+"}
            </span>
          </button>
        </div>

        {customOpen ? (
          <div
            className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3"
            data-testid="display-custom-accent-panel"
          >
            <div className="flex items-start gap-3">
              <HslColorPicker
                color={customDraft}
                onChange={(c) => setCustomDraft({ h: Math.round(c.h), s: Math.round(c.s), l: Math.round(c.l) })}
                style={{ width: 200, height: 160 }}
              />
              <div className="flex-1 space-y-2 text-xs">
                <div>
                  <label className="block text-slate-500" htmlFor="display-custom-accent-hex">
                    {dict.settings.displayAccentHex}
                  </label>
                  <input
                    id="display-custom-accent-hex"
                    data-testid="display-custom-accent-hex-input"
                    type="text"
                    value={hslToHex(customDraft.h, customDraft.s, customDraft.l)}
                    onChange={(e) => {
                      const parsed = hexToHsl(e.target.value);
                      if (parsed) setCustomDraft(parsed);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-7 w-7 rounded-md border border-slate-200"
                    style={{ background: `hsl(${customDraft.h} ${customDraft.s}% ${customDraft.l}%)` }}
                  />
                  <span
                    data-testid="display-custom-accent-aa-badge"
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      customPassesAA
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700",
                    )}
                  >
                    {customPassesAA
                      ? dict.settings.displayAccentAaPass
                      : dict.settings.displayAccentAaFail}
                  </span>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setCustomDraft({ h: 238, s: 84, l: 60 });
                      void saveAccent(DEFAULT_THEME_ACCENT);
                      setCustomOpen(false);
                    }}
                    data-testid="display-custom-accent-reset"
                  >
                    {dict.settings.displayAccentReset}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      void saveAccent({ kind: "custom", ...customDraft });
                    }}
                    data-testid="display-custom-accent-apply"
                  >
                    {dict.settings.displayAccentApply}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* Phase 2C — Density toggle. Compact (default) ↔ Comfortable.          */}
      <section
        className="space-y-3 rounded-xl border border-slate-200 bg-white/90 p-4"
        data-testid="display-density-section"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {dict.settings.displayDensityTitle}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {dict.settings.displayDensityDescription}
          </p>
        </div>
        <div role="radiogroup" aria-label="Density" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {(["compact", "comfortable"] as const).map((value) => {
            const on = density === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => void saveDensity(value)}
                data-testid={`display-density-toggle-${value}`}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition",
                  on
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                {value === "compact"
                  ? dict.settings.displayDensityCompact
                  : dict.settings.displayDensityComfortable}
              </button>
            );
          })}
        </div>
      </section>

      <section
        className="space-y-3 rounded-xl border border-slate-200 bg-white/90 p-4"
        data-testid="display-timeframes-section"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {dict.settings.displayTimeframesTitle}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {dict.settings.displayTimeframesDescription}
          </p>
        </div>
        <CustomizeRangesPopover
          variant="inline"
          onSaved={onTimeframesSaved}
          copy={{
            title: dict.settings.customizeRangesTitle,
            activeSectionLabel: dict.settings.customizeRangesActiveLabel,
            addCustomLabel: dict.settings.customizeRangesAddCustomLabel,
            addCustomPlaceholder: dict.settings.customizeRangesAddPlaceholder,
            addCustomHint: dict.settings.customizeRangesAddHint,
            saveLabel: dict.settings.customizeRangesSaveLabel,
            savingLabel: dict.settings.customizeRangesSavingLabel,
            resetLabel: dict.settings.customizeRangesResetLabel,
            saveSuccess: dict.settings.customizeRangesSaveSuccess,
            saveError: dict.settings.customizeRangesSaveError,
            closeLabel: dict.settings.customizeRangesCloseLabel,
            toggleOnLabel: (range) =>
              dict.settings.customizeRangesToggleOnLabel.replace("{range}", range),
            toggleOffLabel: (range) =>
              dict.settings.customizeRangesToggleOffLabel.replace("{range}", range),
          }}
        />
      </section>

      <section
        className="space-y-3 rounded-xl border border-slate-200 bg-white/90 p-4"
        data-testid="display-reporting-currency-section"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {dict.settings.displayReportingCurrencyTitle}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {dict.settings.displayReportingCurrencyDescription}
          </p>
        </div>

        {shellData.portfolioCapabilities && configuredCurrencies.length === 0 ? (
          <ZeroAccountSetupGate
            dict={dict}
            canManageAccounts={canManageAccounts}
            returnTo={pathname}
          />
        ) : configuredCurrencies.length === 1 ? (
          <SingleCapabilityContext
            label={dict.settings.displayReportingCurrencyTitle}
            value={effectiveReportingCurrency ?? shellData.reportingCurrency}
            description={dict.settings.displayReportingCurrencyDescription}
            testId="display-reporting-currency-single"
          />
        ) : (
          <div className="flex items-center gap-3">
            <select
              data-testid="reporting-currency-select"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={effectiveReportingCurrency ?? shellData.reportingCurrency}
              disabled={shellData.isReportingCurrencySaving}
              onChange={(event) => {
                const next = event.target.value;
                if (configuredCurrencies.includes(next as AccountDefaultCurrency)) {
                  void handleReportingCurrencyChange(next as AccountDefaultCurrency);
                }
              }}
            >
              {configuredCurrencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            {currencySavedFlash ? (
              <span
                className="text-xs text-emerald-700"
                role="status"
                data-testid="reporting-currency-saved"
              >
                {dict.settings.displayReportingCurrencySaved}
              </span>
            ) : null}
          </div>
        )}

        {normalization ? (
          <CapabilityNormalizationNotice
            dict={dict}
            kind="reportingCurrency"
            normalization={normalization}
          />
        ) : null}

        {shellData.reportingCurrencyError ? (
          <p
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
            role="alert"
            data-testid="reporting-currency-error"
          >
            {shellData.reportingCurrencyError}
          </p>
        ) : null}
      </section>

      <section
        className="space-y-3 rounded-xl border border-slate-200 bg-white/90 p-4"
        data-testid="display-price-color-convention-section"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {dict.settings.displayPriceColorConventionTitle}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {dict.settings.displayPriceColorConventionDescription}
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label={dict.settings.displayPriceColorConventionTitle}
          className="grid gap-2 sm:grid-cols-2"
        >
          {PRICE_COLOR_CONVENTIONS.map((value) => {
            const on = priceColorConvention === value;
            const gainClass = value === "gain_green_loss_red" ? "text-[hsl(var(--success))]" : "text-[hsl(var(--destructive))]";
            const lossClass = value === "gain_green_loss_red" ? "text-[hsl(var(--destructive))]" : "text-[hsl(var(--success))]";
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={priceColorSaving}
                onClick={() => {
                  if (!on) void savePriceColorConvention(value);
                }}
                data-testid={`display-price-color-convention-${value}`}
                className={cn(
                  "flex min-w-0 flex-col items-start gap-2 rounded-lg border px-3 py-3 text-left text-sm transition",
                  on
                    ? "border-slate-900 bg-white shadow-sm"
                    : "border-slate-200 bg-slate-50/70 hover:border-slate-300",
                  priceColorSaving && "cursor-not-allowed opacity-70",
                )}
              >
                <span className="font-medium text-slate-900">
                  {value === "gain_green_loss_red"
                    ? dict.settings.displayPriceColorConventionGreenGain
                    : dict.settings.displayPriceColorConventionRedGain}
                </span>
                <span className="flex gap-3 font-mono text-xs tabular-nums">
                  <span className={gainClass}>+1.25%</span>
                  <span className={lossClass}>-1.25%</span>
                </span>
              </button>
            );
          })}
        </div>

        {priceColorSavedFlash ? (
          <span
            className="text-xs text-emerald-700"
            role="status"
            data-testid="price-color-convention-saved"
          >
            {dict.settings.displayPriceColorConventionSaved}
          </span>
        ) : null}

        {priceColorError ? (
          <p
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
            role="alert"
            data-testid="price-color-convention-error"
          >
            {priceColorError}
          </p>
        ) : null}
      </section>

      <section
        className="space-y-3 rounded-xl border border-slate-200 bg-white/90 p-4"
        data-testid="display-layout-section"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {dict.settings.displayLayoutTitle}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {dict.settings.displayLayoutDescription}
          </p>
        </div>

        {resetError ? (
          <p
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
            role="alert"
            data-testid="reset-layout-error"
          >
            {resetError}
          </p>
        ) : null}
        {resetMessage ? (
          <p
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700"
            role="status"
            data-testid="reset-layout-success"
          >
            {resetMessage}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void runReset("dashboard")}
            disabled={resetting !== null}
            data-testid="reset-dashboard-layout-btn"
          >
            {dict.settings.resetDashboardLayoutButton}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void runReset("transactions")}
            disabled={resetting !== null}
            data-testid="reset-transactions-layout-btn"
          >
            {dict.settings.resetTransactionsLayoutButton}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void runReset("portfolio")}
            disabled={resetting !== null}
            data-testid="reset-portfolio-layout-btn"
          >
            {dict.settings.resetPortfolioLayoutButton}
          </Button>
        </div>

        <div className="border-t border-slate-200 pt-3">
          <Button
            onClick={() => void runReset("all")}
            disabled={resetting !== null}
            data-testid="reset-all-layouts-btn"
          >
            {dict.settings.resetAllLayoutsButton}
          </Button>
        </div>
      </section>
    </div>
  );
}
