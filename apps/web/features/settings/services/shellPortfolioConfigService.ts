import { getJson } from "../../../lib/api";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  marketCodeFor,
  type AccountDto,
  type PortfolioCapabilitiesDto,
  type ShellPortfolioConfigDto as SharedShellPortfolioConfigDto,
} from "@vakwen/shared-types";

export type ShellPortfolioConfigDto = SharedShellPortfolioConfigDto;

export type ShellPortfolioConfigSeedDto = Omit<ShellPortfolioConfigDto, "capabilities"> & {
  capabilities?: PortfolioCapabilitiesDto;
};

type LegacyShellPortfolioConfigWireDto = Omit<ShellPortfolioConfigDto, "capabilities"> & {
  capabilities?: PortfolioCapabilitiesDto | null;
};

export async function fetchShellPortfolioConfig(): Promise<ShellPortfolioConfigDto> {
  const response = await getJson<LegacyShellPortfolioConfigWireDto>("/settings/fee-config");

  return {
    ...response,
    capabilities: response.capabilities ?? deriveCapabilitiesFromAccounts(response.accounts),
  };
}

function deriveCapabilitiesFromAccounts(
  accounts: readonly AccountDto[],
): PortfolioCapabilitiesDto {
  const configuredCurrencies = ACCOUNT_DEFAULT_CURRENCIES.filter((currency) =>
    accounts.some((account) => account.defaultCurrency === currency));
  return {
    configuredMarkets: configuredCurrencies.map(marketCodeFor),
    configuredCurrencies: [...configuredCurrencies],
  };
}
