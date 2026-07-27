import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordFxTransferDialog } from "../../../components/fx-transfer/RecordFxTransferDialog";
import { AddTransactionDialog } from "../../../components/portfolio/AddTransactionDialog";
import { RecordTransactionDialog } from "../../../components/portfolio/RecordTransactionDialog";
import { getDictionary } from "../../../lib/i18n";

const addTransactionCardPropsMock = vi.hoisted(() => ({
  current: null as null | Record<string, unknown>,
}));

vi.mock("../../../components/portfolio/AddTransactionCard", () => ({
  AddTransactionCard: (props: Record<string, unknown>) => {
    addTransactionCardPropsMock.current = props;
    return <form data-testid="mock-add-transaction-card"><button type="submit">Submit transaction</button></form>;
  },
}));

vi.mock("../../../components/fx-transfer/AddFxTransferCard", () => ({
  AddFxTransferCard: () => <form data-testid="mock-add-fx-transfer-card"><button type="submit">Submit FX transfer</button></form>,
}));

vi.mock("../../../features/fx-transfer/hooks/useFxTransferEstimate", () => ({
  useFxTransferEstimate: () => ({
    estimate: null,
    error: "",
    hardBlocked: false,
    loading: false,
  }),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("transaction dialog layout", () => {
  let container: HTMLDivElement;
  let root: Root;
  const dict = getDictionary("en");

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("keeps the transaction form dialog viewport-safe on mobile", () => {
    act(() => {
      root.render(
        <RecordTransactionDialog
          open
          onOpenChange={vi.fn()}
          value={{} as never}
          onChange={vi.fn()}
          onSubmit={vi.fn(async () => undefined)}
          pending={false}
          accountOptions={[]}
          message=""
          errorMessage=""
          title="Add transaction"
          dict={dict}
          locale="en"
          priceHint={null}
          showPriceUnavailableHint={false}
          feeEstimate={null}
        />,
      );
    });

    const dialog = document.body.querySelector("[data-testid='record-transaction-dialog']");
    expect(dialog?.className).toContain("max-h-[calc(100dvh_-_2rem)]");
    expect(dialog?.className).toContain("overflow-y-auto");
    expect(dialog?.className).toContain("w-[calc(100%_-_2rem)]");
    expect(document.body.querySelector("[data-testid='mock-add-transaction-card']")).not.toBeNull();
  });

  it("keeps the command palette add transaction dialog viewport-safe on mobile", () => {
    act(() => {
      root.render(
        <AddTransactionDialog
          open
          onOpenChange={vi.fn()}
          value={{} as never}
          onChange={vi.fn()}
          onSubmit={vi.fn(async () => undefined)}
          pending={false}
          accountOptions={[]}
          availableMarkets={["TW"]}
          message=""
          errorMessage=""
          dict={dict}
          locale="en"
          priceHint={null}
          showPriceUnavailableHint={false}
          feeEstimate={null}
        />,
      );
    });

    const dialog = document.body.querySelector("[data-testid='add-transaction-dialog']");
    expect(dialog?.className).toContain("max-h-[calc(100dvh_-_2rem)]");
    expect(dialog?.className).toContain("overflow-y-auto");
    expect(dialog?.className).toContain("max-w-[calc(100%_-_2rem)]");
    expect(document.body.querySelector("[data-testid='mock-add-transaction-card']")).not.toBeNull();
    expect(addTransactionCardPropsMock.current?.availableMarkets).toEqual(["TW"]);
  });

  it("keeps the FX transfer dialog viewport-safe on mobile", () => {
    act(() => {
      root.render(
        <RecordFxTransferDialog
          open
          mode="create"
          accounts={[]}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
          dict={dict}
          locale="en"
        />,
      );
    });

    const dialog = document.body.querySelector("[data-testid='record-fx-transfer-dialog']");
    expect(dialog?.className).toContain("max-h-[calc(100dvh_-_2rem)]");
    expect(dialog?.className).toContain("overflow-y-auto");
    expect(dialog?.className).toContain("w-[calc(100%_-_2rem)]");
    expect(document.body.querySelector("[data-testid='mock-add-fx-transfer-card']")).not.toBeNull();
  });
});
