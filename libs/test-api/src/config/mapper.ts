import { apiAssistantRegistry } from "@vakwen/test-framework/config";
import { capitalReductionsApiAssistantFactory } from "../assistants/capitalReductions/index.js";
import { CapitalReductionsEndpoint } from "../endpoints/CapitalReductionsEndpoint.js";
import { accountsApiAssistantFactory } from "../assistants/accounts/index.js";
import { adminApiAssistantFactory } from "../assistants/admin/index.js";
import { anonymousShareTokensApiAssistantFactory } from "../assistants/anonymous-share-tokens/index.js";
import { dividendsApiAssistantFactory } from "../assistants/dividends/index.js";
import { feeProfilesApiAssistantFactory } from "../assistants/feeProfiles/index.js";
import { fxRatesApiAssistantFactory } from "../assistants/fxRates/index.js";
import { fxTransfersApiAssistantFactory } from "../assistants/fxTransfers/index.js";
import { instrumentsApiAssistantFactory } from "../assistants/instruments/index.js";
import { marketDataApiAssistantFactory } from "../assistants/marketData/index.js";
import { notificationsApiAssistantFactory } from "../assistants/notifications/index.js";
import { profileApiAssistantFactory } from "../assistants/profile/index.js";
import { providersApiAssistantFactory } from "../assistants/providers/index.js";
import { quotesApiAssistantFactory } from "../assistants/quotes/index.js";
import { sessionApiAssistantFactory } from "../assistants/session/index.js";
import { sharesApiAssistantFactory } from "../assistants/shares/index.js";
import { settingsApiAssistantFactory } from "../assistants/settings/index.js";
import { transactionsApiAssistantFactory } from "../assistants/transactions/index.js";
import { AccountsEndpoint } from "../endpoints/AccountsEndpoint.js";
import { AdminEndpoint } from "../endpoints/AdminEndpoint.js";
import { AnonymousShareTokensEndpoint } from "../endpoints/AnonymousShareTokensEndpoint.js";
import { DividendsEndpoint } from "../endpoints/DividendsEndpoint.js";
import { FeeProfilesEndpoint } from "../endpoints/FeeProfilesEndpoint.js";
import { FxRatesEndpoint } from "../endpoints/FxRatesEndpoint.js";
import { FxTransfersEndpoint } from "../endpoints/FxTransfersEndpoint.js";
import { InstrumentsEndpoint } from "../endpoints/InstrumentsEndpoint.js";
import { MarketDataEndpoint } from "../endpoints/MarketDataEndpoint.js";
import { NotificationsEndpoint } from "../endpoints/NotificationsEndpoint.js";
import { ProfileEndpoint } from "../endpoints/ProfileEndpoint.js";
import { ProvidersEndpoint } from "../endpoints/ProvidersEndpoint.js";
import { QuotesEndpoint } from "../endpoints/QuotesEndpoint.js";
import { SessionEndpoint } from "../endpoints/SessionEndpoint.js";
import { SharesEndpoint } from "../endpoints/SharesEndpoint.js";
import { SettingsEndpoint } from "../endpoints/SettingsEndpoint.js";
import { TransactionsEndpoint } from "../endpoints/TransactionsEndpoint.js";

let registered = false;

export function registerTestApiAssistants(): void {
  if (registered) {
    return;
  }

  apiAssistantRegistry.register(AccountsEndpoint, accountsApiAssistantFactory);
  apiAssistantRegistry.register(CapitalReductionsEndpoint, capitalReductionsApiAssistantFactory);
  apiAssistantRegistry.register(AdminEndpoint, adminApiAssistantFactory);
  apiAssistantRegistry.register(AnonymousShareTokensEndpoint, anonymousShareTokensApiAssistantFactory);
  apiAssistantRegistry.register(DividendsEndpoint, dividendsApiAssistantFactory);
  apiAssistantRegistry.register(FeeProfilesEndpoint, feeProfilesApiAssistantFactory);
  apiAssistantRegistry.register(FxRatesEndpoint, fxRatesApiAssistantFactory);
  apiAssistantRegistry.register(FxTransfersEndpoint, fxTransfersApiAssistantFactory);
  apiAssistantRegistry.register(InstrumentsEndpoint, instrumentsApiAssistantFactory);
  apiAssistantRegistry.register(MarketDataEndpoint, marketDataApiAssistantFactory);
  apiAssistantRegistry.register(NotificationsEndpoint, notificationsApiAssistantFactory);
  apiAssistantRegistry.register(ProfileEndpoint, profileApiAssistantFactory);
  apiAssistantRegistry.register(ProvidersEndpoint, providersApiAssistantFactory);
  apiAssistantRegistry.register(QuotesEndpoint, quotesApiAssistantFactory);
  apiAssistantRegistry.register(SessionEndpoint, sessionApiAssistantFactory);
  apiAssistantRegistry.register(SharesEndpoint, sharesApiAssistantFactory);
  apiAssistantRegistry.register(SettingsEndpoint, settingsApiAssistantFactory);
  apiAssistantRegistry.register(TransactionsEndpoint, transactionsApiAssistantFactory);
  registered = true;
}
