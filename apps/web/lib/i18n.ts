import type { LocaleCode } from "@vakwen/shared-types";
import { layoutI18n } from "../components/layout/i18n";
import { cashLedgerI18n } from "../features/cash-ledger/i18n";
import { analysisI18n } from "../features/analysis/i18n";
import { dashboardI18n } from "../features/dashboard/i18n";
import { dividendsI18n } from "../features/dividends/i18n";
import { notificationsI18n } from "../features/notifications/i18n";
import { portfolioI18n } from "../features/portfolio/i18n";
import { portfolioCapabilitiesI18n } from "../features/portfolio-capabilities/i18n";
import { sharingI18n } from "../features/sharing/i18n";
import { settingsI18n } from "../features/settings/i18n";
import { commonI18n } from "./i18n/common";
import type { AppDictionary } from "./i18n/types";

export type { AppDictionary } from "./i18n/types";
export { formatRecomputeMessage } from "../features/portfolio/i18n";

export function getDictionary(locale: LocaleCode): AppDictionary {
  const localeKey = locale === "zh-TW" ? "zh-TW" : "en";

  const settingsBlock = settingsI18n[localeKey];
  return {
    ...commonI18n[localeKey],
    ...analysisI18n[localeKey],
    ...cashLedgerI18n[localeKey],
    ...dashboardI18n[localeKey],
    ...dividendsI18n[localeKey],
    ...notificationsI18n[localeKey],
    ...portfolioCapabilitiesI18n[localeKey],
    ...settingsBlock,
    // KZO-196 — `gics` lives on `settingsI18n` but the spread above does not
    // re-emit narrowly-typed sibling keys; pinning explicitly keeps the
    // returned `AppDictionary["gics"]` typing intact.
    gics: settingsBlock.gics,
    ...portfolioI18n[localeKey],
    ...sharingI18n[localeKey],
    ...layoutI18n[localeKey],
    tooltips: {
      ...dashboardI18n[localeKey].tooltips,
      ...settingsI18n[localeKey].tooltips,
      ...portfolioI18n[localeKey].tooltips,
    },
  };
}
