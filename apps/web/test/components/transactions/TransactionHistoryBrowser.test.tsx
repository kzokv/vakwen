import { act, type AnchorHTMLAttributes } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { getDictionary } from "../../../lib/i18n";
import { TransactionHistoryBrowser } from "../../../components/transactions/TransactionHistoryBrowser";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("TransactionHistoryBrowser", () => {
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

  it("renders active filter chips and a safe back-to-report link", () => {
    const onChange = vi.fn();

    act(() => {
      root.render(
        <TransactionHistoryBrowser
          accountOptions={[{ id: "acc-1", name: "Main", feeProfileName: "Default", defaultCurrency: "USD" }]}
          availableMarkets={["TW", "US"]}
          data={{
            items: [],
            total: 12,
            limit: 50,
            offset: 0,
            aggregates: { realizedPnlByCurrency: [{ currency: "USD", amount: 123.45 }] },
          }}
          dict={getDictionary("en")}
          errorMessage=""
          isLoading={false}
          locale="en"
          onChange={onChange}
          onSort={vi.fn()}
          state={{
            type: "SELL",
            pnl: "realized",
            marketCode: "US",
            accountId: "acc-1",
            ticker: "MSFT",
            from: "2026-05-01",
            to: "2026-06-01",
            limit: 50,
            offset: 0,
            sortBy: "tradeDate",
            sortOrder: "desc",
            returnTo: "/reports?tab=portfolio&scope=US&range=1M",
          }}
        />,
      );
    });

    expect(document.querySelector("[data-testid='transaction-history-back-link']")?.getAttribute("href"))
      .toBe("/reports?tab=portfolio&scope=US&range=1M");
    expect(document.querySelector("[data-testid='transaction-history-active-chips']")?.textContent)
      .toContain("Ticker: MSFT");
    expect(document.querySelector("[data-testid='transaction-history-active-chips']")?.textContent)
      .toContain("P&L: Realized only");
    expect(document.querySelector("[data-testid='transaction-history-active-chips']")?.textContent)
      .not.toContain("Type: SELL");
    expect(document.querySelector("[data-testid='transaction-history-subtotals']")?.textContent)
      .toContain("USD");
  });

  it("limits market options to configured markets only", () => {
    act(() => {
      root.render(
        <TransactionHistoryBrowser
          accountOptions={[]}
          availableMarkets={["TW", "US"]}
          data={{
            items: [],
            total: 0,
            limit: 50,
            offset: 0,
            aggregates: { realizedPnlByCurrency: [] },
          }}
          dict={getDictionary("en")}
          errorMessage=""
          isLoading={false}
          locale="en"
          onChange={vi.fn()}
          onSort={vi.fn()}
          state={{
            type: "ALL",
            pnl: "any",
            marketCode: "ALL",
            accountId: "ALL",
            ticker: "",
            from: "",
            to: "",
            limit: 50,
            offset: 0,
            sortBy: "tradeDate",
            sortOrder: "desc",
            returnTo: null,
          }}
        />,
      );
    });

    const select = document.querySelector("[data-testid='transaction-history-market-filter']") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map((option) => option.value)).toEqual(["ALL", "TW", "US"]);
  });

  it("renders static market context when exactly one configured market exists", () => {
    act(() => {
      root.render(
        <TransactionHistoryBrowser
          accountOptions={[]}
          availableMarkets={["TW"]}
          data={{
            items: [],
            total: 0,
            limit: 50,
            offset: 0,
            aggregates: { realizedPnlByCurrency: [] },
          }}
          dict={getDictionary("en")}
          errorMessage=""
          isLoading={false}
          locale="en"
          onChange={vi.fn()}
          onSort={vi.fn()}
          state={{
            type: "ALL",
            pnl: "any",
            marketCode: "ALL",
            accountId: "ALL",
            ticker: "",
            from: "",
            to: "",
            limit: 50,
            offset: 0,
            sortBy: "tradeDate",
            sortOrder: "desc",
            returnTo: null,
          }}
        />,
      );
    });

    expect(document.querySelector("[data-testid='transaction-history-market-context-single']")).not.toBeNull();
    expect(document.querySelector("[data-testid='transaction-history-market-filter']")).toBeNull();
  });
});
