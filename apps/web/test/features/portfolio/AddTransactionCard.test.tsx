import { afterEach, beforeAll, describe, expect, it } from "vitest";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AddTransactionCard,
  buildCreateAccountHref,
  deriveDefaultMarketChip,
  filterAccountsByDerivedCurrency,
  type TransactionAccountOption,
} from "../../../components/portfolio/AddTransactionCard";
import { getDictionary } from "../../../lib/i18n";
import type { TransactionInput } from "../../../components/portfolio/types";

const dict = getDictionary("en");

// KZO-169 — Frontend Implementer's TDD red specs for slice 5 / 6 / 7. These
// tests assert the chip-default derivation, account-filter logic, inline
// no-account-error rendering, and the create-account deep-link href.
//
// Companion files exercised:
//  - apps/web/components/portfolio/AddTransactionCard.tsx (derive helpers)
//  - apps/web/components/portfolio/InstrumentCombobox.tsx (ALL-mode suffix)

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const TWD_ACCOUNT: TransactionAccountOption = {
  id: "acc-tw",
  name: "Yuanta",
  feeProfileName: "Default Broker",
  defaultCurrency: "TWD",
  accountType: "broker",
};
const USD_ACCOUNT: TransactionAccountOption = {
  id: "acc-us",
  name: "Schwab",
  feeProfileName: "US Broker",
  defaultCurrency: "USD",
  accountType: "broker",
};
const AUD_ACCOUNT: TransactionAccountOption = {
  id: "acc-au",
  name: "CommSec",
  feeProfileName: "AU Broker",
  defaultCurrency: "AUD",
  accountType: "broker",
};
const JPY_ACCOUNT: TransactionAccountOption = {
  id: "acc-jp",
  name: "SBI",
  feeProfileName: "JP Broker",
  defaultCurrency: "JPY",
  accountType: "broker",
};

describe("deriveDefaultMarketChip — ui-enhancement (2026-05-13)", () => {
  // ui-enhancement scope items 20–22: ALL chip removed from the Record
  // Transaction surface. Default chip is now the FIRST account's market
  // (replaces only-currency-or-null semantics). Empty list → "TW" fallback.

  it("returns the matching MarketCode when all accounts share one currency (TW-only user)", () => {
    expect(deriveDefaultMarketChip([TWD_ACCOUNT, { ...TWD_ACCOUNT, id: "acc-tw-2" }])).toBe("TW");
  });

  it("returns 'US' when all accounts share USD", () => {
    expect(deriveDefaultMarketChip([USD_ACCOUNT])).toBe("US");
  });

  it("returns 'AU' when all accounts share AUD", () => {
    expect(deriveDefaultMarketChip([AUD_ACCOUNT])).toBe("AU");
  });

  it("returns the FIRST account's market for multi-currency users", () => {
    expect(deriveDefaultMarketChip([TWD_ACCOUNT, USD_ACCOUNT])).toBe("TW");
    expect(deriveDefaultMarketChip([USD_ACCOUNT, TWD_ACCOUNT, AUD_ACCOUNT])).toBe("US");
  });

  it("returns 'TW' when accounts list is empty (defensive fallback per scope item 21)", () => {
    expect(deriveDefaultMarketChip([])).toBe("TW");
  });
});

describe("filterAccountsByDerivedCurrency — KZO-169 D8b", () => {
  it("returns the full list when derived currency is null (no commit yet)", () => {
    const accounts = [TWD_ACCOUNT, USD_ACCOUNT];
    expect(filterAccountsByDerivedCurrency(accounts, null).map((a) => a.id)).toEqual([
      "acc-tw",
      "acc-us",
    ]);
  });

  it("filters to TWD accounts when derived currency = TWD", () => {
    const accounts = [TWD_ACCOUNT, USD_ACCOUNT, AUD_ACCOUNT];
    expect(filterAccountsByDerivedCurrency(accounts, "TWD").map((a) => a.id)).toEqual([
      "acc-tw",
    ]);
  });

  it("returns empty array when no account matches the derived currency (D8c trigger)", () => {
    const accounts = [TWD_ACCOUNT];
    expect(filterAccountsByDerivedCurrency(accounts, "USD")).toEqual([]);
  });
});

describe("buildCreateAccountHref — KZO-169 NC4 deep-link (Phase 3d route-driven)", () => {
  it("returns a /settings/accounts deep-link with the prefill currency, regardless of caller pathname", () => {
    // Phase 3d S10 — settings drawer retired. Destination is now the
    // absolute /settings/accounts route; pathname arg is preserved for
    // back-compat but ignored.
    expect(buildCreateAccountHref("/dashboard", "USD")).toBe(
      "/settings/accounts?accountsPrefillCurrency=USD",
    );
    expect(buildCreateAccountHref("/transactions", "AUD")).toBe(
      "/settings/accounts?accountsPrefillCurrency=AUD",
    );
  });
});

describe("AddTransactionCard — chip + account-filter render contract", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  function valueWith(overrides: Partial<TransactionInput> = {}): TransactionInput {
    return {
      accountId: "",
      ticker: "",
      marketCode: null,
      quantity: 1,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-04-30",
      type: "BUY",
      isDayTrade: false,
      ...overrides,
    };
  }

  function setInputValue(selector: string, value: string): HTMLInputElement {
    const input = document.querySelector(selector) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input;
  }

  it("renders the supported market chip pills, including JP, without the removed ALL chip", () => {
    // ui-enhancement (2026-05-13) — ALL chip removed from this surface.
    // Settings → Tickers catalog browser keeps ALL.
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({ accountId: "acc-tw", marketCode: "TW" })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );
    expect(html).toContain('data-testid="tx-market-chip-TW"');
    expect(html).toContain('data-testid="tx-market-chip-US"');
    expect(html).toContain('data-testid="tx-market-chip-AU"');
    expect(html).toContain('data-testid="tx-market-chip-KR"');
    expect(html).toContain('data-testid="tx-market-chip-JP"');
    expect(html).not.toContain('data-testid="tx-market-chip-ALL"');
  });

  it("renders the inline no-account error block ONLY in the zero-account state (ui-enhancement)", () => {
    // ui-enhancement (2026-05-13): the `account → chip` one-way binding
    // removes the chip → account filter. The error block now triggers
    // only when the user has zero accounts at all.
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({ marketCode: null })}
        accountOptions={[]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );
    expect(html).toContain('data-testid="tx-no-account-error"');
    expect(html).toContain('data-testid="tx-create-account-link"');
    // Account dropdown is NOT rendered in this state — replaced by the error block.
    expect(html).not.toContain('data-testid="tx-account-select"');
  });

  it("filters the account dropdown to accounts compatible with the selected market chip", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({ marketCode: "JP" })}
        accountOptions={[TWD_ACCOUNT, USD_ACCOUNT, AUD_ACCOUNT, JPY_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );
    expect(html).toContain('data-testid="tx-account-select"');
    expect(html).toContain('value="acc-jp"');
    expect(html).not.toContain('value="acc-tw"');
    expect(html).not.toContain('value="acc-us"');
    expect(html).not.toContain('value="acc-au"');
    expect(html).not.toContain('data-testid="tx-no-account-error"');
  });

  it("limits rendered market chips to the configured market subset", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({ marketCode: "TW" })}
        accountOptions={[TWD_ACCOUNT, USD_ACCOUNT, AUD_ACCOUNT]}
        availableMarkets={["TW", "US"]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );

    expect(html).toContain('data-testid="tx-market-chip-TW"');
    expect(html).toContain('data-testid="tx-market-chip-US"');
    expect(html).not.toContain('data-testid="tx-market-chip-AU"');
    expect(html).not.toContain('data-testid="tx-market-chip-KR"');
    expect(html).not.toContain('data-testid="tx-market-chip-JP"');
  });

  it("does not expose fallback market chips when no market is configured", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({ marketCode: null })}
        accountOptions={[]}
        availableMarkets={[]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );

    expect(html).not.toContain('data-testid="tx-market-chip-TW"');
    expect(html).not.toContain('data-testid="tx-market-chip-US"');
    expect(html).not.toContain('data-testid="tx-market-chip-AU"');
    expect(html).not.toContain('data-testid="tx-market-chip-KR"');
    expect(html).not.toContain('data-testid="tx-market-chip-JP"');
    expect(html).toContain('data-testid="tx-no-account-error"');
  });

  it("renders a static market context when only one configured market exists", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({ marketCode: "TW" })}
        accountOptions={[TWD_ACCOUNT]}
        availableMarkets={["TW"]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );

    expect(html).toContain('data-testid="tx-market-context-single"');
    expect(html).not.toContain('data-testid="tx-market-chip-TW"');
  });

  it("renders gross trade value plus BUY cash-out using manual fee overrides ahead of estimates", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({
          accountId: "acc-tw",
          marketCode: "TW",
          ticker: "2330",
          quantity: 3,
          unitPrice: 10.125,
          commissionAmount: 2,
          taxAmount: 1,
          type: "BUY",
        })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={{ commissionAmount: 99, taxAmount: 99, reason: "estimate" } as never}
      />,
    );

    expect(html).toContain('data-testid="gross-trade-value-amount"');
    expect(html).toContain("NT$30.38");
    expect(html).toContain("NT$33.38");
  });

  it("renders SELL settlement as unavailable when fees are unavailable", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({
          accountId: "acc-tw",
          marketCode: "TW",
          ticker: "2330",
          quantity: 2,
          unitPrice: 50,
          commissionAmount: undefined,
          taxAmount: undefined,
          type: "SELL",
        })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );

    expect(html).toContain('data-testid="gross-trade-value-amount"');
    expect(html).toContain("NT$100");
    expect(html).toContain('data-testid="settlement-value-unavailable"');
  });

  it("does NOT render the no-account error when the chip matches an existing account currency", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({ accountId: "acc-tw", marketCode: "TW" })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );
    expect(html).not.toContain('data-testid="tx-no-account-error"');
    expect(html).toContain('data-testid="tx-account-select"');
  });

  it("disables submit when chip + ticker not committed", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <AddTransactionCard
          value={valueWith({ accountId: "acc-tw", ticker: "", marketCode: null })}
          accountOptions={[TWD_ACCOUNT]}
          pending={false}
          onChange={() => undefined}
          onSubmit={async () => undefined}
          dict={dict}
          locale="en"
          framed={false}
          priceHint={null}
          showPriceUnavailableHint={false}
          feeEstimate={null}
        />,
      );
    });
    const submitButton = container.querySelector('[data-testid="tx-submit-button"]') as HTMLButtonElement | null;
    expect(submitButton).not.toBeNull();
    expect(submitButton!.disabled).toBe(true);
  });

  it("enables submit when account + ticker + marketCode are all set with a compatible account", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <AddTransactionCard
          value={valueWith({ accountId: "acc-tw", ticker: "2330", marketCode: "TW" })}
          accountOptions={[TWD_ACCOUNT]}
          pending={false}
          onChange={() => undefined}
          onSubmit={async () => undefined}
          dict={dict}
          locale="en"
          framed={false}
          priceHint={null}
          showPriceUnavailableHint={false}
          feeEstimate={null}
        />,
      );
    });
    const submitButton = container.querySelector('[data-testid="tx-submit-button"]') as HTMLButtonElement | null;
    expect(submitButton).not.toBeNull();
    expect(submitButton!.disabled).toBe(false);
  });

  it("accepts decimal commission and tax overrides and preserves empty-input semantics on submit", async () => {
    const submitted: TransactionInput[] = [];

    function Harness() {
      const [value, setValue] = useState<TransactionInput>(
        valueWith({
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          quantity: 10,
          unitPrice: 100,
          type: "SELL",
        }),
      );

      return (
        <AddTransactionCard
          value={value}
          accountOptions={[TWD_ACCOUNT]}
          pending={false}
          onChange={setValue}
          onSubmit={async () => {
            submitted.push(value);
          }}
          dict={dict}
          locale="en"
          framed={false}
          priceHint={null}
          showPriceUnavailableHint={false}
          feeEstimate={{ commissionAmount: 1.2345, taxAmount: 0.6789 }}
        />
      );
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<Harness />);
    });

    const commissionInput = document.querySelector('[data-testid="commission-override-input"]') as HTMLInputElement;
    const taxInput = document.querySelector('[data-testid="tax-override-input"]') as HTMLInputElement;
    expect(commissionInput.step).toBe("0.0001");
    expect(commissionInput.inputMode).toBe("decimal");
    expect(taxInput.step).toBe("0.0001");
    expect(taxInput.inputMode).toBe("decimal");

    await act(async () => {
      setInputValue('[data-testid="commission-override-input"]', "1.2345");
      setInputValue('[data-testid="tax-override-input"]', "0.6789");
    });

    expect(commissionInput.value).toBe("1.2345");
    expect(taxInput.value).toBe("0.6789");

    const submitButton = document.querySelector('[data-testid="tx-submit-button"]') as HTMLButtonElement;
    await act(async () => {
      submitButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(submitted.at(-1)).toMatchObject({
      commissionAmount: 1.2345,
      taxAmount: 0.6789,
    });

    await act(async () => {
      setInputValue('[data-testid="commission-override-input"]', "");
      setInputValue('[data-testid="tax-override-input"]', "");
    });

    expect(commissionInput.value).toBe("");
    expect(taxInput.value).toBe("");

    await act(async () => {
      submitButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(submitted.at(-1)).toMatchObject({
      commissionAmount: undefined,
      taxAmount: undefined,
    });
  });

  it("renders ready sell availability guidance with a Use max action", async () => {
    function Harness() {
      const [value, setValue] = useState<TransactionInput>(
        valueWith({
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          quantity: 1,
          unitPrice: 100,
          tradeDate: "2026-04-30",
          type: "SELL",
        }),
      );

      return (
        <AddTransactionCard
          value={value}
          accountOptions={[TWD_ACCOUNT]}
          pending={false}
          onChange={setValue}
          onSubmit={async () => undefined}
          dict={dict}
          locale="en"
          framed={false}
          priceHint={null}
          showPriceUnavailableHint={false}
        feeEstimate={null}
        sellAvailability={{
          status: "ready",
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          tradeDate: "2026-04-30",
          availableQuantity: 17,
        }}
        sellAvailabilityRequestKey="acc-tw|2330|TW|2026-04-30"
      />
      );
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<Harness />);
    });

    expect(container.textContent).toContain("Available to sell: 17");
    expect((container.querySelector('[data-testid="tx-quantity-input"]') as HTMLInputElement | null)?.max).toBe("17");

    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="sell-availability-use-max"]')?.click();
    });

    expect((container.querySelector('[data-testid="tx-quantity-input"]') as HTMLInputElement | null)?.value).toBe("17");
  });

  it("disables SELL submit while sell availability is loading", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          quantity: 2,
          unitPrice: 50,
          tradeDate: "2026-04-30",
          type: "SELL",
        })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
        isSellAvailabilityLoading
      />,
    );

    expect(html).toContain('data-testid="sell-availability-loading"');
    expect(html).toContain("disabled");
  });

  it("disables Use max and submit when sell availability is zero", () => {
    container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          quantity: 1,
          unitPrice: 50,
          tradeDate: "2026-04-30",
          type: "SELL",
        })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
        sellAvailability={{
          status: "ready",
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          tradeDate: "2026-04-30",
          availableQuantity: 0,
        }}
        sellAvailabilityRequestKey="acc-tw|2330|TW|2026-04-30"
      />,
    );

    expect(container.querySelector<HTMLButtonElement>('[data-testid="sell-availability-use-max"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="tx-submit-button"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[data-testid="tx-quantity-input"]')?.value).toBe("1");
  });

  it("shows an inline oversell error and blocks submit when quantity exceeds known availability", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={valueWith({
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          quantity: 12,
          unitPrice: 50,
          tradeDate: "2026-04-30",
          type: "SELL",
        })}
        accountOptions={[TWD_ACCOUNT]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
        sellAvailability={{
          status: "ready",
          accountId: "acc-tw",
          ticker: "2330",
          marketCode: "TW",
          tradeDate: "2026-04-30",
          availableQuantity: 5,
        }}
        sellAvailabilityRequestKey="acc-tw|2330|TW|2026-04-30"
      />,
    );

    expect(html).toContain('data-testid="sell-availability-oversell"');
    expect(html).toContain("Requested 12 exceeds available quantity 5.");
    expect(html).toContain("disabled");
  });
});
