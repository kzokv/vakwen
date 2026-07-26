/**
 * KZO-179 / KZO-183 — Web-unit tests for AccountCreateForm.
 *
 * Verifies (post KZO-183):
 *   - Renders 4 base fields (name, type pills, market cards, callout). The
 *     fee-profile picker was removed entirely — the route auto-seeds a
 *     default profile, so the client never sets `feeProfileId`.
 *   - Live-preview chip updates as inputs change (reuses
 *     `formatAccountOption` per D13 / `nextjs-i18n-serialization.md`).
 *   - Submit button disabled when name is empty (or whitespace-only).
 *   - Submit calls `onCreate` with `{name, defaultCurrency, accountType}` —
 *     NO `feeProfileId` — and `onAccountsRefresh` after success (D12).
 *   - Inline 409 error rendering uses `accountCreateNameInUseError` text.
 *   - Inline generic error rendering uses `accountCreateGenericError` text.
 *   - Market labels render Taiwan / United States / Australia / South Korea / Japan per E3.
 *
 * Pattern mirrors `apps/web/test/features/cash-ledger/CashLedgerClient.test.tsx`
 * (react-dom/client + act() — not RTL — to match the project's existing
 * web-unit harness).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AccountMutationResponseDto } from "@vakwen/shared-types";
import { AccountCreateForm } from "../../../../features/settings/components/AccountCreateForm";
import { ApiError } from "../../../../lib/api";
import { getDictionary } from "../../../../lib/i18n";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

function buildAccountDto(overrides: Record<string, unknown> = {}): AccountMutationResponseDto {
  const account = {
    id: "new-account-id",
    name: "USD Brokerage",
    userId: "user-1",
    feeProfileId: "fp-default",
    defaultCurrency: "USD" as const,
    accountType: "bank" as const,
    ...overrides,
  };
  return {
    ...account,
    account,
    feeProfile: {
      id: "fp-default",
      accountId: account.id,
      name: "USD Default",
      boardCommissionRate: 1.425,
      commissionDiscountPercent: 0,
      minimumCommissionAmount: 20,
      commissionCurrency: account.defaultCurrency,
      commissionRoundingMode: "FLOOR",
      taxRoundingMode: "FLOOR",
      stockSellTaxRateBps: 30,
      stockDayTradeTaxRateBps: 15,
      etfSellTaxRateBps: 10,
      bondEtfSellTaxRateBps: 0,
      commissionChargeMode: "CHARGED_UPFRONT",
    },
    capabilities: {
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    },
    reportingCurrency: {
      requested: account.defaultCurrency,
      effective: account.defaultCurrency,
      reason: null,
    },
    changedFields: ["name", "accountType"],
  };
}

describe("AccountCreateForm", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // ── Render shape ───────────────────────────────────────────────────────────

  it("starts on the market step, shows all supported markets, and keeps the fee-profile picker removed", () => {
    const onCreate = vi.fn();
    const onAccountsRefresh = vi.fn();

    act(() =>
      root.render(
        <AccountCreateForm
          onCreate={onCreate}
          onAccountsRefresh={onAccountsRefresh}
          dict={dict}
        />,
      ),
    );

    const formShell = container.querySelector('[data-testid="account-create-form"]') as HTMLElement;
    expect(formShell).toBeTruthy();
    expect(formShell.className).not.toContain(["glass", "inset"].join("-"));
    expect(container.querySelector('[data-testid="account-create-name-input"]')).toBeNull();
    expect(container.querySelector('[data-testid="account-create-type-broker"]')).toBeNull();

    // Market cards (5) — TWD, USD, AUD, KRW, JPY; labels read country names per E3.
    const tw = container.querySelector('[data-testid="account-create-currency-TWD"]');
    const us = container.querySelector('[data-testid="account-create-currency-USD"]');
    const au = container.querySelector('[data-testid="account-create-currency-AUD"]');
    const kr = container.querySelector('[data-testid="account-create-currency-KRW"]');
    const jp = container.querySelector('[data-testid="account-create-currency-JPY"]');
    expect(tw).toBeTruthy();
    expect(us).toBeTruthy();
    expect(au).toBeTruthy();
    expect(kr).toBeTruthy();
    expect(jp).toBeTruthy();
    expect(tw!.textContent).toContain(dict.settings.accountCreateMarketTaiwan);
    expect(us!.textContent).toContain(dict.settings.accountCreateMarketUnitedStates);
    expect(au!.textContent).toContain(dict.settings.accountCreateMarketAustralia);
    expect(kr!.textContent).toContain(dict.settings.accountCreateMarketKorea);
    expect(jp!.textContent).toContain(dict.settings.accountCreateMarketJapan);

    expect(container.querySelector('[data-testid="account-create-continue"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="account-create-preview-chip"]')).toBeTruthy();

    // KZO-183: fee-profile picker removed.
    expect(container.querySelector('[data-testid="account-create-fee-profile-select"]')).toBeNull();
  });

  it("uses a market -> details -> review flow for first-account onboarding", async () => {
    act(() =>
      root.render(
        <AccountCreateForm
          onCreate={vi.fn()}
          onAccountsRefresh={vi.fn()}
          dict={dict}
          isFirstAccount
        />,
      ),
    );

    expect(container.textContent).toContain(dict.settings.accountCreateStepMarket);
    expect(container.textContent).toContain(dict.settings.accountCreateStepDetails);
    expect(container.textContent).toContain(dict.settings.accountCreateStepReview);
    expect(container.querySelector('[data-testid="account-create-step-market"]')).not.toBeNull();

    const continueFromMarket = container.querySelector('[data-testid="account-create-continue"]') as HTMLButtonElement;
    await act(async () => continueFromMarket.click());
    expect(container.querySelector('[data-testid="account-create-step-details"]')).not.toBeNull();

    const nameInput = container.querySelector(
      '[data-testid="account-create-name-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nameInput, "First account");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const continueFromDetails = container.querySelector('[data-testid="account-create-continue"]') as HTMLButtonElement;
    await act(async () => continueFromDetails.click());

    expect(container.querySelector('[data-testid="account-create-step-review"]')).not.toBeNull();
    expect(container.textContent).toContain("First account");
    expect(container.textContent).toContain(dict.settings.accountCreateDefaultProfileReview);
  });

  it("labels already-enabled markets without blocking another account in the same market", async () => {
    act(() =>
      root.render(
        <AccountCreateForm
          onCreate={vi.fn()}
          onAccountsRefresh={vi.fn()}
          dict={dict}
          existingAccounts={[
            buildAccountDto({ id: "acc-us", defaultCurrency: "USD", name: "Existing US" }).account,
          ] as never}
        />,
      ),
    );

    const usdCard = container.querySelector('[data-testid="account-create-currency-USD"]') as HTMLButtonElement;
    await act(async () => usdCard.click());

    expect(container.querySelector('[data-testid="account-create-enabled-market-note"]')?.textContent)
      .toContain(dict.settings.accountCreateAlreadyEnabled);
    expect(container.querySelector('[data-testid="account-create-continue"]')).not.toBeNull();
  });

  // ── Live-preview chip updates ──────────────────────────────────────────────

  it("live-preview chip updates as name + type + currency change", async () => {
    act(() =>
      root.render(
        <AccountCreateForm
          onCreate={vi.fn()}
          onAccountsRefresh={vi.fn()}
          dict={dict}
        />,
      ),
    );

    const chip = container.querySelector('[data-testid="account-create-preview-chip"]') as HTMLElement;
    // Empty initial state → placeholder text.
    expect(chip.textContent).toContain(dict.settings.accountCreateNamePlaceholder);

    const usdCard = container.querySelector('[data-testid="account-create-currency-USD"]') as HTMLButtonElement;
    await act(async () => usdCard.click());
    const continueFromMarket = container.querySelector('[data-testid="account-create-continue"]') as HTMLButtonElement;
    await act(async () => continueFromMarket.click());

    const nameInput = container.querySelector(
      '[data-testid="account-create-name-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nameInput, "USD Brokerage");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Click Bank type pill.
    const bankPill = container.querySelector('[data-testid="account-create-type-bank"]') as HTMLButtonElement;
    await act(async () => bankPill.click());

    // Chip should now read "USD Brokerage (USD · Bank)" (formatAccountOption shape).
    expect(chip.textContent).toContain("USD Brokerage");
    expect(chip.textContent).toContain("USD");
    expect(chip.textContent).toContain("Bank");
  });

  // ── Submit-disabled guard ──────────────────────────────────────────────────

  it("submit button is disabled when name is empty or whitespace-only; enabled otherwise", async () => {
    act(() =>
      root.render(
        <AccountCreateForm
          onCreate={vi.fn()}
          onAccountsRefresh={vi.fn()}
          dict={dict}
        />,
      ),
    );

    const continueFromMarket = container.querySelector('[data-testid="account-create-continue"]') as HTMLButtonElement;
    await act(async () => continueFromMarket.click());

    // Whitespace-only stays disabled.
    const nameInput = container.querySelector(
      '[data-testid="account-create-name-input"]',
    ) as HTMLInputElement;
    const setNameValue = (value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nameInput, value);
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const continueFromDetails = container.querySelector(
      '[data-testid="account-create-continue"]',
    ) as HTMLButtonElement;

    await act(async () => setNameValue("   "));
    expect(continueFromDetails.disabled).toBe(true);

    await act(async () => setNameValue("Real Account"));
    expect(continueFromDetails.disabled).toBe(false);

    await act(async () => setNameValue(""));
    expect(continueFromDetails.disabled).toBe(true);
  });

  // ── Happy-path submit calls onCreate + onAccountsRefresh + resets ─────────

  it("submit calls onCreate with the resolved input then onAccountsRefresh, and resets the form", async () => {
    const onCreate = vi.fn().mockResolvedValue(buildAccountDto());
    const onAccountsRefresh = vi.fn();

    act(() =>
      root.render(
        <AccountCreateForm
          onCreate={onCreate}
          onAccountsRefresh={onAccountsRefresh}
          dict={dict}
        />,
      ),
    );

    const usdCard = container.querySelector('[data-testid="account-create-currency-USD"]') as HTMLButtonElement;
    await act(async () => usdCard.click());
    const continueFromMarket = container.querySelector('[data-testid="account-create-continue"]') as HTMLButtonElement;
    await act(async () => continueFromMarket.click());

    const nameInput = container.querySelector(
      '[data-testid="account-create-name-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nameInput, "USD Brokerage");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const bankPill = container.querySelector('[data-testid="account-create-type-bank"]') as HTMLButtonElement;
    await act(async () => bankPill.click());
    const continueFromDetails = container.querySelector('[data-testid="account-create-continue"]') as HTMLButtonElement;
    await act(async () => continueFromDetails.click());

    // Submit.
    const submit = container.querySelector(
      '[data-testid="account-create-submit"]',
    ) as HTMLButtonElement;
    await act(async () => submit.click());

    // KZO-183: onCreate received only the trimmed name + chosen type/currency
    // — feeProfileId is no longer on the input shape.
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith({
      name: "USD Brokerage",
      defaultCurrency: "USD",
      accountType: "bank",
    });
    // onAccountsRefresh fired after onCreate resolved.
    expect(onAccountsRefresh).toHaveBeenCalledTimes(1);

    expect(container.querySelector('[data-testid="account-create-success"]')?.textContent)
      .toContain("USD Brokerage");
    expect(container.querySelector('[data-testid="account-create-name-input"]')).toBeNull();
  });

  // ── Inline error rendering ────────────────────────────────────────────────

  it("renders accountCreateNameInUseError on a 409 ApiError; does NOT call onAccountsRefresh", async () => {
    const onCreate = vi.fn().mockRejectedValue(
      new ApiError("An account with that name already exists.", 409, "account_name_in_use"),
    );
    const onAccountsRefresh = vi.fn();

    act(() =>
      root.render(
        <AccountCreateForm
          onCreate={onCreate}
          onAccountsRefresh={onAccountsRefresh}
          dict={dict}
        />,
      ),
    );

    const continueFromMarket = container.querySelector('[data-testid="account-create-continue"]') as HTMLButtonElement;
    await act(async () => continueFromMarket.click());

    const nameInput = container.querySelector(
      '[data-testid="account-create-name-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nameInput, "Main");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const continueFromDetails = container.querySelector(
      '[data-testid="account-create-continue"]',
    ) as HTMLButtonElement;
    await act(async () => continueFromDetails.click());
    const submit = container.querySelector('[data-testid="account-create-submit"]') as HTMLButtonElement;
    await act(async () => submit.click());

    const errorEl = container.querySelector('[data-testid="account-create-error"]');
    expect(errorEl).toBeTruthy();
    expect(errorEl!.textContent).toBe(dict.settings.accountCreateNameInUseError);
    expect(onAccountsRefresh).not.toHaveBeenCalled();

    // Form is NOT reset on error — name remains so user can retry.
    expect(nameInput.value).toBe("Main");
  });

  it("renders accountCreateGenericError on a non-409 failure (network / 500)", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("boom"));
    const onAccountsRefresh = vi.fn();

    act(() =>
      root.render(
        <AccountCreateForm
          onCreate={onCreate}
          onAccountsRefresh={onAccountsRefresh}
          dict={dict}
        />,
      ),
    );

    const continueFromMarket = container.querySelector('[data-testid="account-create-continue"]') as HTMLButtonElement;
    await act(async () => continueFromMarket.click());

    const nameInput = container.querySelector(
      '[data-testid="account-create-name-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nameInput, "Some Name");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const continueFromDetails = container.querySelector(
      '[data-testid="account-create-continue"]',
    ) as HTMLButtonElement;
    await act(async () => continueFromDetails.click());
    const submit = container.querySelector('[data-testid="account-create-submit"]') as HTMLButtonElement;
    await act(async () => submit.click());

    const errorEl = container.querySelector('[data-testid="account-create-error"]');
    expect(errorEl).toBeTruthy();
    expect(errorEl!.textContent).toBe(dict.settings.accountCreateGenericError);
    expect(onAccountsRefresh).not.toHaveBeenCalled();
  });
});
