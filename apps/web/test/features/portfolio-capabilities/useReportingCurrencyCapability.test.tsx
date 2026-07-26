import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDefaultCurrency, PortfolioCapabilitiesDto } from "@vakwen/shared-types";
import { useReportingCurrencyCapability } from "../../../features/portfolio-capabilities/useReportingCurrencyCapability";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildCapabilities(configuredCurrencies: AccountDefaultCurrency[]): PortfolioCapabilitiesDto {
  return {
    configuredMarkets: configuredCurrencies.length > 0 ? ["TW"] : [],
    configuredCurrencies,
  };
}

describe("useReportingCurrencyCapability", () => {
  let container: HTMLDivElement;
  let root: Root;
  let result: ReturnType<typeof useReportingCurrencyCapability>;

  function Harness({
    capabilities,
    reportingCurrency,
    isSharedContext,
    onNormalizeReportingCurrency,
  }: {
    capabilities: PortfolioCapabilitiesDto | null;
    reportingCurrency: AccountDefaultCurrency;
    isSharedContext: boolean;
    onNormalizeReportingCurrency: (currency: AccountDefaultCurrency, options?: { refreshRouter?: boolean }) => Promise<void>;
  }) {
    result = useReportingCurrencyCapability({
      capabilities,
      reportingCurrency,
      isSharedContext,
      onNormalizeReportingCurrency,
    });
    return null;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("normalizes stale owner preferences without a router refresh", async () => {
    const onNormalizeReportingCurrency = vi.fn(async () => undefined);

    act(() => {
      root.render(
        <Harness
          capabilities={buildCapabilities(["TWD"])}
          reportingCurrency="USD"
          isSharedContext={false}
          onNormalizeReportingCurrency={onNormalizeReportingCurrency}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.effectiveReportingCurrency).toBe("TWD");
    expect(result.normalization?.reason).toBe("unconfigured_currency");
    expect(onNormalizeReportingCurrency).toHaveBeenCalledWith("TWD", { refreshRouter: false });
  });

  it("keeps shared stale preferences display-only", async () => {
    const onNormalizeReportingCurrency = vi.fn(async () => undefined);

    act(() => {
      root.render(
        <Harness
          capabilities={buildCapabilities(["TWD"])}
          reportingCurrency="USD"
          isSharedContext
          onNormalizeReportingCurrency={onNormalizeReportingCurrency}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.effectiveReportingCurrency).toBe("TWD");
    expect(result.normalization?.reason).toBe("unconfigured_currency");
    expect(onNormalizeReportingCurrency).not.toHaveBeenCalled();
  });
});
