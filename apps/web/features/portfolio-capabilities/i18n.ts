import type { AppDictionary } from "../../lib/i18n/types";

export const portfolioCapabilitiesI18n: Record<
  "en" | "zh-TW",
  Pick<AppDictionary, "portfolioCapabilities">
> = {
  en: {
    portfolioCapabilities: {
      zeroAccountGateTitle: "Set up an account before using this view",
      zeroAccountGateDescription: "This area depends on configured account markets and currencies. Open account settings to add your first account.",
      zeroAccountGateReadonly: "This shared view is read-only until the portfolio owner adds an account.",
      zeroAccountGateAction: "Open account settings",
      normalizationNoticeTitle: "Selection updated",
      unconfiguredMarket: "The requested market is not configured here. Showing {value} instead.",
      unconfiguredReportScope: "The requested report scope is not configured here. Showing {value} instead.",
      unconfiguredCurrency: "The requested reporting currency is not configured here. Showing {value} instead.",
      noConfiguredMarkets: "No configured markets are available yet.",
      noConfiguredCurrencies: "No configured reporting currencies are available yet.",
      dismissNormalizationNotice: "Dismiss selection update notice",
      noneAvailable: "nothing",
    },
  },
  "zh-TW": {
    portfolioCapabilities: {
      zeroAccountGateTitle: "請先設定帳戶再使用這個畫面",
      zeroAccountGateDescription: "這個區域會依賴已設定帳戶的市場與幣別。請前往帳戶設定新增第一個帳戶。",
      zeroAccountGateReadonly: "在投資組合擁有者新增帳戶前，這個共享畫面會維持唯讀。",
      zeroAccountGateAction: "開啟帳戶設定",
      normalizationNoticeTitle: "已更新選擇",
      unconfiguredMarket: "要求的市場尚未設定，已改為顯示 {value}。",
      unconfiguredReportScope: "要求的報表範圍尚未設定，已改為顯示 {value}。",
      unconfiguredCurrency: "要求的報表幣別尚未設定，已改為顯示 {value}。",
      noConfiguredMarkets: "目前尚未設定任何市場。",
      noConfiguredCurrencies: "目前尚未設定任何報表幣別。",
      dismissNormalizationNotice: "關閉選擇更新提示",
      noneAvailable: "無可用項目",
    },
  },
};
