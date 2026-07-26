import { TestEnv } from "@vakwen/config/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";
import type { Page } from "@playwright/test";

async function forceAnalysisPreviewFallback(page: Page) {
  const appOrigin = new URL(TestEnv.appBaseUrl).origin;
  await page.route("**/analysis/unrealized-pnl**", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin || url.pathname !== "/analysis/unrealized-pnl") {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ message: "analysis preview fallback" }),
    });
  });
}

async function forcePreviewThenRefreshFailure(page: Page) {
  const appOrigin = new URL(TestEnv.appBaseUrl).origin;
  await page.route("**/analysis/unrealized-pnl**", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin || url.pathname !== "/analysis/unrealized-pnl") {
      await route.continue();
      return;
    }

    if (url.searchParams.get("drivers") === "10") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "analysis refresh failed after filters changed" }),
      });
      return;
    }

    await route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ message: "analysis preview fallback" }),
    });
  });
}

async function openPreviewAnalysis(page: Page, viewport: { width: number; height: number } = { width: 1440, height: 960 }) {
  await forceAnalysisPreviewFallback(page);
  await page.setViewportSize(viewport);
  await page.goto(new URL("/analysis/unrealized-pnl?selection=topDrivers&drivers=5&tickerMode=allEligible", TestEnv.appBaseUrl).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Unrealized P&L Analysis" }).waitFor({ state: "visible" });
  await page.getByText("Preview contract fallback").waitFor({ state: "visible" });
  await page.getByLabel("Unrealized P&L comparison chart").waitFor({ state: "visible" });
}

test("[analysis-unrealized-pnl-A]: open analysis, select ticker lines, and scrub focus → URL state is preserved", async ({
  appShell,
  page,
}) => {
  await forceAnalysisPreviewFallback(page);
  await appShell.actions.setViewport(1440, 960);
  await page.goto(new URL("/analysis", TestEnv.appBaseUrl).href, { waitUntil: "domcontentloaded" });

  await page.getByRole("heading", { name: "Analysis workspaces" }).waitFor({ state: "visible" });
  await page.getByRole("link", { name: "Open analysis" }).click();
  await page.getByRole("heading", { name: "Unrealized P&L Analysis" }).waitFor({ state: "visible" });
  await page.getByText("Preview contract fallback").waitFor({ state: "visible" });
  await page.getByLabel("Unrealized P&L comparison chart").waitFor({ state: "visible" });
  await page.getByTestId("analysis-chart-legend").getByText("NVIDIA Corporation").waitFor({ state: "visible" });
  await page.getByText("Top drivers").waitFor({ state: "visible" });
  await page.getByText("Manual tickers").waitFor({ state: "visible" });
  await page.getByTestId("analysis-selected-detail").getByText("Selected ticker detail").waitFor({ state: "visible" });

  await page.getByTestId("analysis-total-detail-trigger").click();
  await page.getByRole("heading", { name: "Total composition" }).waitFor({ state: "visible" });
  await page.keyboard.press("Escape");

  await page.locator("button").filter({ hasText: /^10$/ }).click();
  await page.waitForURL(/drivers=10/);
  await appShell.assert.mxAssertEqual(new URL(page.url()).searchParams.get("drivers"), "10", "driver count URL state");

  await page.getByRole("button", { name: "Manual tickers", exact: true }).click();
  await page.waitForURL(/selection=manualTickers/);
  const selectionUrl = new URL(page.url());
  await appShell.assert.mxAssertEqual(selectionUrl.searchParams.get("selection"), "manualTickers", "manual selection URL state");
  await appShell.assert.mxAssertEqual(selectionUrl.searchParams.get("tickerMode"), null, "manual all-eligible ticker mode remains implicit");

  await page.getByTestId("analysis-ticker-picker-trigger").click();
  await page.getByRole("checkbox", { name: /NVIDIA|NVDA/i }).click();
  await page.waitForURL(/tickerMode=custom/);
  const tickerUrl = new URL(page.url());
  await appShell.assert.mxAssertEqual(tickerUrl.searchParams.get("tickerMode"), "custom", "custom ticker mode URL state");
  await appShell.assert.mxAssertTruthy(Boolean(tickerUrl.searchParams.get("tickerIds")), "selected ticker URL state");

  await page.getByTestId("analysis-focus-scrub").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForURL(/focus=/);
  await appShell.assert.mxAssertTruthy(Boolean(new URL(page.url()).searchParams.get("focus")), "focus date URL state");
});

test("[analysis-unrealized-pnl-B]: stale US reports deep-link → configured TW analysis state is preserved", async ({
  appShell,
  page,
}) => {
  await forceAnalysisPreviewFallback(page);
  await appShell.actions.setViewport(1440, 960);
  await page.goto(new URL("/reports?tab=daily-review&scope=US&range=1M", TestEnv.appBaseUrl).href, { waitUntil: "domcontentloaded" });

  const basisStrip = page.getByTestId("reports-basis-strip");
  await basisStrip.waitFor({ state: "visible" });
  await basisStrip.getByText("Valuation basis").waitFor({ state: "visible" });
  await basisStrip.getByText("Reports stay on the current-valuation path.").waitFor({ state: "visible" });
  await page.getByTestId("reports-basis-market-TW").waitFor({ state: "visible" });
  await page.getByTestId("reports-basis-fx").getByText("FX", { exact: true }).waitFor({ state: "visible" });

  const link = page.getByTestId("reports-summary-unrealized-pnl-analysis-link");
  await link.waitFor({ state: "visible" });

  const href = await link.getAttribute("href");
  await appShell.assert.mxAssertTruthy(Boolean(href?.startsWith("/analysis/unrealized-pnl")), "reports summary analysis link target");
  const target = new URL(href ?? "/analysis/unrealized-pnl", TestEnv.appBaseUrl);
  await appShell.assert.mxAssertEqual(target.searchParams.get("range"), "1M", "reports range maps into analysis state");
  await appShell.assert.mxAssertEqual(target.searchParams.get("markets"), "TW", "normalized reports scope maps into analysis state");

  await link.click();
  await page.getByRole("heading", { name: "Unrealized P&L Analysis" }).waitFor({ state: "visible" });
  await appShell.assert.isOnRoute(/\/analysis\/unrealized-pnl/);
});

test("[analysis-unrealized-pnl-C]: ticker picker search, grouping, and dismissal → popover state is predictable", async ({
  appShell,
  page,
}) => {
  await openPreviewAnalysis(page);

  await page.getByTestId("analysis-ticker-picker-trigger").click();
  const picker = page.getByTestId("analysis-ticker-picker");
  await picker.waitFor({ state: "visible" });
  await picker.getByText("AU", { exact: true }).waitFor({ state: "visible" });
  await picker.getByText("TW", { exact: true }).waitFor({ state: "visible" });
  await picker.getByText("US", { exact: true }).waitFor({ state: "visible" });

  await picker.locator("input").first().fill("nvidia");
  await picker.getByText("US:NVDA:NVIDIA Corporation").waitFor({ state: "visible" });
  await appShell.assert.mxAssertEqual(
    await picker.getByText("TW:2330:Taiwan Semiconductor Manufacturing").count(),
    0,
    "ticker picker search hides non-matching rows",
  );

  await page.keyboard.press("Escape");
  await picker.waitFor({ state: "hidden" });

  await page.getByTestId("analysis-ticker-picker-trigger").click();
  await page.getByTestId("analysis-ticker-picker").getByText("TW:2330:Taiwan Semiconductor Manufacturing").waitFor({ state: "visible" });
  const nvdaCheckbox = page.getByTestId("analysis-ticker-picker").getByRole("checkbox", { name: /NVIDIA|NVDA/i }).first();
  await nvdaCheckbox.focus();
  await page.keyboard.press("Space");
  await page.waitForURL(/tickerMode=custom/);
  await appShell.assert.mxAssertEqual(await nvdaCheckbox.isChecked(), false, "keyboard toggles ticker checkbox");
  await page.mouse.click(20, 20);
  await page.getByTestId("analysis-ticker-picker").waitFor({ state: "hidden" });
});

test("[analysis-unrealized-pnl-D]: top-driver legend mute and detail layout controls → detail stays stable", async ({
  appShell,
  page,
}) => {
  await openPreviewAnalysis(page);

  const legend = page.getByTestId("analysis-chart-legend");
  const nvdaLegend = legend.getByRole("button", { name: "NVIDIA Corporation" });
  await appShell.assert.mxAssertEqual(await nvdaLegend.getAttribute("aria-pressed"), "true", "top-driver legend starts active");
  await nvdaLegend.focus();
  await page.keyboard.press("Space");
  await appShell.assert.mxAssertEqual(await nvdaLegend.getAttribute("aria-pressed"), "false", "keyboard mutes top-driver legend item");
  await appShell.assert.mxAssertTruthy(
    (await page.getByTestId("analysis-selected-detail").getByTestId("analysis-detail-muted").textContent())?.includes("NVIDIA Corporation"),
    "muted detail row keeps muted ticker available",
  );

  await page.getByRole("button", { name: "Cards", exact: true }).click();
  await page.getByTestId("analysis-selected-detail").getByTestId("analysis-detail-expanded").first().waitFor({ state: "visible" });
  await page.getByTestId("analysis-selected-detail").getByRole("table").waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByTestId("analysis-selected-detail").getByRole("table").waitFor({ state: "visible" });
  await page.getByTestId("analysis-selected-detail").getByTestId("analysis-detail-expanded").first().waitFor({ state: "hidden" });

  await page.locator("button").filter({ hasText: /^10$/ }).click();
  await page.waitForURL(/drivers=10/);
  await appShell.assert.mxAssertEqual(await nvdaLegend.getAttribute("aria-pressed"), "true", "top-driver mute resets after driver recompute");
});

test("[analysis-unrealized-pnl-E]: manual legend selection and ticker detail links → URL state is explicit", async ({
  appShell,
  page,
}) => {
  await forceAnalysisPreviewFallback(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(new URL("/analysis/unrealized-pnl?accountIds=acc-us-growth", TestEnv.appBaseUrl).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Unrealized P&L Analysis" }).waitFor({ state: "visible" });
  await page.getByText("Preview contract fallback").waitFor({ state: "visible" });
  await page.getByLabel("Unrealized P&L comparison chart").waitFor({ state: "visible" });

  const detailLink = page.getByTestId("analysis-selected-detail").getByRole("link", { name: "US:NVDA" }).first();
  const href = await detailLink.getAttribute("href");
  const target = new URL(href ?? "", TestEnv.appBaseUrl);
  await appShell.assert.mxAssertEqual(target.pathname, "/tickers/NVDA", "ticker detail route path");
  await appShell.assert.mxAssertEqual(target.searchParams.get("marketCode"), "US", "ticker detail market scope");
  await appShell.assert.mxAssertEqual(target.searchParams.get("source"), "unrealized-pnl-analysis", "ticker detail analysis source");
  await appShell.assert.mxAssertTruthy(Boolean(target.searchParams.get("fromDate")), "ticker detail analysis from date");
  await appShell.assert.mxAssertTruthy(Boolean(target.searchParams.get("toDate")), "ticker detail analysis to date");
  await appShell.assert.mxAssertEqual(target.searchParams.get("accountId"), "acc-us-growth", "ticker detail account scope");

  await page.getByRole("button", { name: "Manual tickers", exact: true }).click();
  await page.waitForURL(/selection=manualTickers/);
  const manualLegend = page.getByTestId("analysis-chart-legend");
  const beforeLegendClick = new URL(page.url());
  const nvdaManualLegend = manualLegend.getByRole("button", { name: "NVIDIA Corporation" });
  await nvdaManualLegend.click();
  const url = new URL(page.url());
  await appShell.assert.mxAssertEqual(url.searchParams.get("selection"), "manualTickers", "manual legend keeps manual mode");
  await appShell.assert.mxAssertEqual(url.searchParams.get("tickerMode"), beforeLegendClick.searchParams.get("tickerMode"), "manual legend keeps ticker mode local");
  await appShell.assert.mxAssertEqual(url.searchParams.get("tickerIds"), beforeLegendClick.searchParams.get("tickerIds"), "manual legend does not remove ticker ids");
  await appShell.assert.mxAssertEqual(await nvdaManualLegend.getAttribute("aria-pressed"), "false", "manual legend dims clicked ticker");
  await appShell.assert.mxAssertTruthy(
    (await page.getByTestId("analysis-selected-detail").textContent())?.includes("NVIDIA Corporation"),
    "manual legend keeps clicked ticker in detail",
  );
  await appShell.assert.mxAssertEqual(
    await page.getByTestId("analysis-selected-detail").getByTestId("analysis-detail-muted").count(),
    1,
    "manual mode shows muted detail row",
  );
});

test("[analysis-unrealized-pnl-F]: failed filter refresh → stale result remains visible with explicit error", async ({
  appShell,
  page,
}) => {
  await forcePreviewThenRefreshFailure(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(new URL("/analysis/unrealized-pnl?selection=topDrivers&drivers=5&tickerMode=allEligible", TestEnv.appBaseUrl).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Unrealized P&L Analysis" }).waitFor({ state: "visible" });
  await page.getByTestId("analysis-chart-legend").getByText("NVIDIA Corporation").waitFor({ state: "visible" });
  await page.getByTestId("analysis-selected-detail").getByRole("link", { name: "US:NVDA" }).first().waitFor({ state: "visible" });

  await page.locator("button").filter({ hasText: /^10$/ }).click();
  await page.waitForURL(/drivers=10/);

  await page.getByText("analysis refresh failed after filters changed").waitFor({ state: "visible" });
  await page.getByTestId("analysis-chart-legend").getByText("NVIDIA Corporation").waitFor({ state: "visible" });
  await page.getByTestId("analysis-selected-detail").getByRole("link", { name: "US:NVDA" }).first().waitFor({ state: "visible" });
  await appShell.assert.mxAssertEqual(new URL(page.url()).searchParams.get("drivers"), "10", "failed refresh keeps immediate URL state");
});

test("[analysis-unrealized-pnl-G]: selected detail disclosure and total stay user-visible in preview fallback → scope copy is present", async ({
  appShell,
  page,
}) => {
  await openPreviewAnalysis(page);

  const detail = page.getByTestId("analysis-selected-detail");
  await detail.getByText("Selected ticker detail").waitFor({ state: "visible" });
  await detail.getByText("Snapshot basis: selected detail uses holding snapshots and snapshot-date FX instead of the live report valuation path.").waitFor({ state: "visible" });
  await detail.getByText("snapshot-date FX").waitFor({ state: "visible" });
  await detail.getByText(/Snapshot sources:/).waitFor({ state: "visible" });
  await detail.getByText(/Snapshot FX as of:/).waitFor({ state: "visible" });
  await detail.getByText("Active selected end unrealized P&L").waitFor({ state: "visible" });
  await detail.getByText("NT$1,020,000").waitFor({ state: "visible" });
  await page.getByTestId("analysis-chart-y-axis-max").getByText(/Max/).waitFor({ state: "visible" });
  await page.getByTestId("analysis-chart-y-axis-zero").getByText(/Zero/).waitFor({ state: "visible" });
  await page.getByTestId("analysis-chart-y-axis-min").getByText(/Min/).waitFor({ state: "visible" });

  await page.setViewportSize({ width: 390, height: 844 });
  await detail.getByText("Snapshot basis: selected detail uses holding snapshots and snapshot-date FX instead of the live report valuation path.").waitFor({ state: "visible" });
  await detail.getByText("Active selected end unrealized P&L").waitFor({ state: "visible" });
  await appShell.assert.mxAssertEqual(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    true,
    "analysis basis disclosure does not introduce mobile horizontal overflow",
  );
});
