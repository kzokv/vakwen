import { afterEach, describe, expect, it, vi } from "vitest";
import { patchAccount, patchFeeProfile } from "../../../../features/settings/services/settingsService";
import { patchJson } from "../../../../lib/api";

vi.mock("../../../../lib/api", () => ({
  patchJson: vi.fn(),
}));

describe("patchFeeProfile", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends the complete editable fee profile payload to the PATCH endpoint", async () => {
    const patch = {
      name: "Main broker",
      boardCommissionRate: 1.425,
      commissionDiscountPercent: 42,
      minimumCommissionAmount: 20,
      commissionCurrency: "TWD" as const,
      commissionRoundingMode: "FLOOR" as const,
      taxRoundingMode: "ROUND" as const,
      stockSellTaxRateBps: 30,
      stockDayTradeTaxRateBps: 15,
      etfSellTaxRateBps: 10,
      bondEtfSellTaxRateBps: 0,
      commissionChargeMode: "CHARGED_UPFRONT" as const,
    };
    vi.mocked(patchJson).mockResolvedValue({ id: "fp-1", ...patch });

    await patchFeeProfile("fp-1", patch);

    expect(patchJson).toHaveBeenCalledWith("/fee-profiles/fp-1", patch);
  });
});

describe("patchAccount", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends editable account fields to the PATCH endpoint", async () => {
    const patch = {
      name: "Main wallet",
      feeProfileId: "fp-2",
      accountType: "wallet" as const,
    };
    vi.mocked(patchJson).mockResolvedValue({ id: "acc-1", ...patch });

    await patchAccount("acc-1", patch);

    expect(patchJson).toHaveBeenCalledWith("/accounts/acc-1", patch);
  });
});
