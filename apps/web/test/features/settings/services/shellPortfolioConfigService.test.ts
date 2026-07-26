import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/api", () => ({
  getJson: vi.fn(),
}));

import { getJson } from "../../../../lib/api";
import { fetchShellPortfolioConfig } from "../../../../features/settings/services/shellPortfolioConfigService";

const baseResponse = {
  accounts: [{
    id: "account-us",
    userId: "user-1",
    name: "US Brokerage",
    feeProfileId: "profile-us",
    defaultCurrency: "USD" as const,
    accountType: "broker" as const,
  }],
  feeProfiles: [],
  feeProfileBindings: [],
  integrityIssue: null,
};

describe("fetchShellPortfolioConfig", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockReset();
  });

  it("derives capabilities from active accounts when an older response omits them", async () => {
    vi.mocked(getJson).mockResolvedValue(baseResponse as never);

    await expect(fetchShellPortfolioConfig()).resolves.toMatchObject({
      capabilities: {
        configuredMarkets: ["US"],
        configuredCurrencies: ["USD"],
      },
    });
  });

  it("preserves authoritative capabilities when the response includes them", async () => {
    vi.mocked(getJson).mockResolvedValue({
      ...baseResponse,
      capabilities: {
        configuredMarkets: ["TW", "US"],
        configuredCurrencies: ["TWD", "USD"],
      },
    } as never);

    await expect(fetchShellPortfolioConfig()).resolves.toMatchObject({
      capabilities: {
        configuredMarkets: ["TW", "US"],
        configuredCurrencies: ["TWD", "USD"],
      },
    });
  });
});
