import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortfolioCapabilitiesDto } from "@vakwen/shared-types";
import { FloatingQuickActions } from "../../../components/dashboard/FloatingQuickActions";
import { getDictionary } from "../../../lib/i18n";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

vi.mock("../../../lib/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("../../../components/ui/shadcn/select", () => {
  let currentOnValueChange: ((value: string) => void) | null = null;
  let currentDisabled = false;
  return {
    Select: ({
      children,
      disabled = false,
      onValueChange,
    }: {
      children: ReactNode;
      disabled?: boolean;
      onValueChange: (value: string) => void;
    }) => {
      currentOnValueChange = onValueChange;
      currentDisabled = disabled;
      return <div>{children}</div>;
    },
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
      <button
        type="button"
        onClick={() => {
          if (!currentDisabled) currentOnValueChange?.(value);
        }}
      >
        {children}
      </button>
    ),
    SelectTrigger: ({ children, ...props }: { children: ReactNode }) => <button type="button" {...props}>{children}</button>,
    SelectValue: () => <span />,
  };
});

describe("FloatingQuickActions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderFloatingQuickActions(capabilities: PortfolioCapabilitiesDto | null) {
    const onReportingCurrencyChange = vi.fn(async () => undefined);

    act(() => {
      root.render(
        <FloatingQuickActions
          hidden={false}
          open
          onOpenChange={() => undefined}
          portfolioCapabilities={capabilities}
          isSharedContext={false}
          canManageAccounts
          reportingCurrency="TWD"
          onReportingCurrencyChange={onReportingCurrencyChange}
          isReportingCurrencySaving={false}
          reportingCurrencyError=""
          onAddTransaction={() => undefined}
          onRecompute={() => undefined}
          onGenerateSnapshots={() => undefined}
          isGeneratingSnapshots={false}
          dict={getDictionary("en")}
        />,
      );
    });

    return { onReportingCurrencyChange };
  }

  it("renders configured currencies only once for multi-currency portfolios", async () => {
    renderFloatingQuickActions({
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD", "USD"],
    });

    await act(async () => {});

    expect(document.body.textContent).toContain("Quick actions");
    expect(document.querySelector("[data-testid='floating-action-reporting-currency']")).not.toBeNull();
    expect(Array.from(document.querySelectorAll("button")).filter((button) => button.textContent?.trim() === "USD"))
      .toHaveLength(1);
    expect(document.body.textContent).not.toContain("AUD");
  });

  it("renders a loading state instead of fabricating a single currency while capabilities are unknown", async () => {
    renderFloatingQuickActions(null);

    await act(async () => {});

    expect(document.querySelector("[data-testid='floating-action-reporting-currency-loading']")).not.toBeNull();
    expect(document.querySelector("[data-testid='floating-action-reporting-currency-single']")).toBeNull();
    expect(document.querySelector("[data-testid='floating-action-reporting-currency']")).toBeNull();
  });

  it("renders the zero-account gate when no configured currencies exist", async () => {
    renderFloatingQuickActions({
      configuredMarkets: [],
      configuredCurrencies: [],
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='portfolio-capabilities-zero-account-gate']")).not.toBeNull();
    expect(document.querySelector("[data-testid='floating-action-reporting-currency']")).toBeNull();
    expect(document.body.textContent).toContain("Set up an account before using this view");
  });

  it("renders static single-currency context when only one currency is configured", async () => {
    renderFloatingQuickActions({
      configuredMarkets: ["US"],
      configuredCurrencies: ["USD"],
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='floating-action-reporting-currency-single']")).not.toBeNull();
    expect(document.body.textContent).toContain("USD");
    expect(document.querySelector("[data-testid='floating-action-reporting-currency']")).toBeNull();
  });

  it("saves reporting currency changes from configured selector options", async () => {
    const { onReportingCurrencyChange } = renderFloatingQuickActions({
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    });

    await act(async () => {});

    const usdButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "USD");
    expect(usdButton).not.toBeNull();

    await act(async () => {
      usdButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onReportingCurrencyChange).toHaveBeenCalledWith("USD");
    expect(document.body.textContent).toContain("Saved");
  });
});
