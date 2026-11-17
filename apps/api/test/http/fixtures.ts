import { createApiFixture } from "@vakwen/test-api/config";
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from "@playwright/test";
import type { TestUser } from "@vakwen/test-framework/core";
import type {
  TCapitalReductionsApiAssistant,
  TAccountsApiAssistant,
  TAdminApiAssistant,
  TAnonymousShareTokensApiAssistant,
  TDividendsApiAssistant,
  TFeeProfilesApiAssistant,
  TFxTransfersApiAssistant,
  TInstrumentsApiAssistant,
  TMarketDataApiAssistant,
  TNotificationsApiAssistant,
  TProfileApiAssistant,
  TQuotesApiAssistant,
  TSessionApiAssistant,
  TSharesApiAssistant,
  TSettingsApiAssistant,
  TTransactionsApiAssistant,
} from "@vakwen/test-api/assistants";
import { createApiSessionTest } from "@vakwen/test-api/fixtures/sessionBase";
import {
  CapitalReductionsEndpoint,
  AccountsEndpoint,
  AdminEndpoint,
  AnonymousShareTokensEndpoint,
  DividendsEndpoint,
  FeeProfilesEndpoint,
  FxTransfersEndpoint,
  InstrumentsEndpoint,
  MarketDataEndpoint,
  NotificationsEndpoint,
  ProfileEndpoint,
  QuotesEndpoint,
  SessionEndpoint,
  SharesEndpoint,
  SettingsEndpoint,
  TransactionsEndpoint,
} from "@vakwen/test-api/endpoints";

const base = createApiSessionTest("oauth");

type THttpApiFixtures = {
  capitalReductionsApi: TCapitalReductionsApiAssistant;
  accountsApi: TAccountsApiAssistant;
  adminApi: TAdminApiAssistant;
  anonymousShareTokensApi: TAnonymousShareTokensApiAssistant;
  dividendsApi: TDividendsApiAssistant;
  feeProfilesApi: TFeeProfilesApiAssistant;
  fxTransfersApi: TFxTransfersApiAssistant;
  instrumentsApi: TInstrumentsApiAssistant;
  marketDataApi: TMarketDataApiAssistant;
  notificationsApi: TNotificationsApiAssistant;
  profileApi: TProfileApiAssistant;
  quotesApi: TQuotesApiAssistant;
  sessionApi: TSessionApiAssistant;
  sharesApi: TSharesApiAssistant;
  settingsApi: TSettingsApiAssistant;
  transactionsApi: TTransactionsApiAssistant;
};

type THttpApiBaseFixtures = {
  e2eUserId: string;
  testUser: TestUser;
};

type THttpApiTest = TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & THttpApiBaseFixtures & THttpApiFixtures,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;

export const test: THttpApiTest = base.extend<THttpApiFixtures>({
  capitalReductionsApi: createApiFixture<TCapitalReductionsApiAssistant>(CapitalReductionsEndpoint),
  sessionApi: createApiFixture<TSessionApiAssistant>(SessionEndpoint),
  settingsApi: createApiFixture<TSettingsApiAssistant>(SettingsEndpoint),
  profileApi: createApiFixture<TProfileApiAssistant>(ProfileEndpoint),
  accountsApi: createApiFixture<TAccountsApiAssistant>(AccountsEndpoint),
  adminApi: createApiFixture<TAdminApiAssistant>(AdminEndpoint),
  dividendsApi: createApiFixture<TDividendsApiAssistant>(DividendsEndpoint),
  feeProfilesApi: createApiFixture<TFeeProfilesApiAssistant>(FeeProfilesEndpoint),
  fxTransfersApi: createApiFixture<TFxTransfersApiAssistant>(FxTransfersEndpoint),
  instrumentsApi: createApiFixture<TInstrumentsApiAssistant>(InstrumentsEndpoint),
  marketDataApi: createApiFixture<TMarketDataApiAssistant>(MarketDataEndpoint),
  notificationsApi: createApiFixture<TNotificationsApiAssistant>(NotificationsEndpoint),
  quotesApi: createApiFixture<TQuotesApiAssistant>(QuotesEndpoint),
  transactionsApi: createApiFixture<TTransactionsApiAssistant>(TransactionsEndpoint),
  sharesApi: createApiFixture<TSharesApiAssistant>(SharesEndpoint),
  anonymousShareTokensApi: createApiFixture<TAnonymousShareTokensApiAssistant>(
    AnonymousShareTokensEndpoint,
  ),
});
