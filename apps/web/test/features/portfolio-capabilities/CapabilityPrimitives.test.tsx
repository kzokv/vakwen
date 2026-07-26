import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "../../../lib/i18n";
import { CapabilityNormalizationNotice } from "../../../features/portfolio-capabilities/components/CapabilityNormalizationNotice";
import { SingleCapabilityContext } from "../../../features/portfolio-capabilities/components/SingleCapabilityContext";
import { ZeroAccountSetupGate } from "../../../features/portfolio-capabilities/components/ZeroAccountSetupGate";

const replaceMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

describe("portfolio capability primitives", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    replaceMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders a single-option static context block", () => {
    act(() => {
      root.render(
        <SingleCapabilityContext
          label="Reporting currency"
          value="TWD"
          description="Fixed by the only configured account currency."
          testId="portfolio-capabilities-single-context-currency"
        />,
      );
    });

    expect(container.querySelector("[data-testid='portfolio-capabilities-single-context-currency']")?.textContent).toContain("TWD");
  });

  it("dismisses normalization notices without remounting the surrounding root", async () => {
    act(() => {
      root.render(
        <CapabilityNormalizationNotice
          dict={dict}
          kind="reportingCurrency"
          normalization={{
            requested: "USD",
            effective: "TWD",
            reason: "unconfigured_currency",
          }}
        />,
      );
    });

    const dismissButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='portfolio-capabilities-normalization-dismiss-reportingCurrency']",
    );

    expect(dismissButton?.tagName).toBe("BUTTON");
    expect(container.querySelector("[data-testid='portfolio-capabilities-normalization-notice-reportingCurrency']")?.textContent)
      .toContain("Showing TWD instead.");

    await act(async () => {
      dismissButton?.click();
    });

    expect(container.querySelector("[data-testid='portfolio-capabilities-normalization-notice-reportingCurrency']")).toBeNull();
  });

  it("suppresses the zero-account CTA for shared read-only viewers", () => {
    act(() => {
      root.render(<ZeroAccountSetupGate dict={dict} canManageAccounts={false} returnTo="/reports?scope=all" />);
    });

    expect(container.querySelector("[data-testid='portfolio-capabilities-zero-account-cta']")).toBeNull();
    expect(container.querySelector("[data-testid='portfolio-capabilities-zero-account-readonly']")?.textContent)
      .toContain("read-only");
  });

  it("navigates to settings/accounts with a safe returnTo via router.replace only", async () => {
    act(() => {
      root.render(<ZeroAccountSetupGate dict={dict} canManageAccounts returnTo="https://evil.example" />);
    });

    const cta = container.querySelector<HTMLButtonElement>("[data-testid='portfolio-capabilities-zero-account-cta']");
    expect(cta?.tagName).toBe("BUTTON");

    await act(async () => {
      cta?.click();
    });

    expect(replaceMock).toHaveBeenCalledWith("/settings/accounts", { scroll: false });
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it("preserves safe internal returnTo when opening account setup", async () => {
    act(() => {
      root.render(<ZeroAccountSetupGate dict={dict} canManageAccounts returnTo="/analysis/unrealized-pnl?reportingCurrency=USD" />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='portfolio-capabilities-zero-account-cta']")?.click();
    });

    expect(replaceMock).toHaveBeenCalledWith(
      "/settings/accounts?returnTo=%2Fanalysis%2Funrealized-pnl%3FreportingCurrency%3DUSD",
      { scroll: false },
    );
  });
});
