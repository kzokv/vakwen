import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { ReauthorizationAssert, assertNoOverflow, mockConsent, mockIndependentSettings, navigateConsent } from "./helpers/reauthorizationFlows";

test.use({ locale: "zh-TW" });

for (const client of ["chatgpt", "claude"] as const) {
  test(`${client} mobile consent: zh-TW replacement selection → fits viewport`, async ({ page }, testInfo) => {
    const check = new ReauthorizationAssert(page);
    await mockConsent(page, client, true);
    await navigateConsent(page);
    await check.createDisabled("建立另一個連線");
    await page.getByRole("radio", { name: "取代現有連線" }).check();
    await page.getByRole("radio", { name: /connection-a/ }).check();
    await check.textVisible(/建立時間:/);
    await page.getByLabel("連線名稱（選填）").fill("研究用連線");
    await assertNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`${client}-consent-zh-TW.png`), fullPage: true, animations: "disabled" });
  });
}

test("mobile independent settings: rename editor and details → responsive controls", async ({ page, appShell }, testInfo) => {
    const check = new ReauthorizationAssert(page);
  await mockIndependentSettings(page);
  await appShell.actions.navigateToRouteForResponsiveTest("/settings/ai-connectors?section=connections");
  const card = page.getByTestId("ai-connector-conn-chatgpt-second");
  await card.getByRole("button", { name: "Rename", exact: true }).click();
  await card.getByLabel("Connection name", { exact: true }).fill("Mobile research");
  await assertNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("settings-rename-mobile.png"), fullPage: true, animations: "disabled" });
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await card.getByRole("button", { name: "Details", exact: true }).click();
  await check.detailsVisible();
  await assertNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("settings-details-mobile.png"), fullPage: true, animations: "disabled" });
  await page.keyboard.press("Escape");
  await check.detailsClosed();
});
