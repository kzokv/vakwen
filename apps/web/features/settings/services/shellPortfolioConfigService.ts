import { getJson } from "../../../lib/api";
import type {
  PortfolioCapabilitiesDto,
  ShellPortfolioConfigDto as SharedShellPortfolioConfigDto,
} from "@vakwen/shared-types";

export interface ShellPortfolioConfigDto extends SharedShellPortfolioConfigDto {
  capabilities?: PortfolioCapabilitiesDto;
}

export async function fetchShellPortfolioConfig(): Promise<ShellPortfolioConfigDto> {
  const response = await getJson<SharedShellPortfolioConfigDto & {
    capabilities?: PortfolioCapabilitiesDto | null;
  }>("/settings/fee-config");

  return {
    ...response,
    capabilities: response.capabilities ?? {
      configuredMarkets: [],
      configuredCurrencies: [],
    },
  };
}
