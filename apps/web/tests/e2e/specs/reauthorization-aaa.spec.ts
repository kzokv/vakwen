import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { ReauthorizationAssert, assertNoOverflow, mockConsent, mockIndependentSettings, navigateConsent } from "./helpers/reauthorizationFlows";

for (const client of ["chatgpt", "claude"] as const) {
  test(`${client} consent: create → explicit independent action and optional label`, async ({ page }) => {
    const check = new ReauthorizationAssert(page);
    const fixture = await mockConsent(page, client);
    await navigateConsent(page);
    await page.getByLabel("Connection name (optional)").fill("Research desk");
    await page.getByRole("button", { name: "Approve", exact: true }).click();

    await check.submittedAction(fixture.submitted, { connectionAction: "create", displayName: "Research desk" });

  });

  test(`${client} consent: cap → select replacement → stale error → refresh without reload`, async ({ page }, testInfo) => {
    const check = new ReauthorizationAssert(page);
    const fixture = await mockConsent(page, client, true);
    await navigateConsent(page);
    await check.createDisabled("Create another connection");
    await check.approvalDisabled();
    await page.getByRole("radio", { name: "Replace an existing connection" }).focus();
    await page.keyboard.press("Space");
    await check.targetUnselected("connection-a");
    await check.approvalDisabled();
    await page.getByRole("radio", { name: /connection-b/ }).check();
    await check.textVisible(/Last used: Never/);
    await assertNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`${client}-replacement-desktop.png`), fullPage: true, animations: "disabled" });
    fixture.makeStale();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await check.staleTargetError();
    await check.submittedAction(fixture.submitted, { connectionAction: "replace", replacementConnectionId: "connection-b" });
    await page.getByLabel("Connection name (optional)").fill("Keep this draft");
    const documentBefore = await page.evaluate(() => performance.timeOrigin);
    await page.getByRole("button", { name: "Refresh available connections" }).click();
    await check.targetUnselected("connection-b");
    await check.nameDraft("Keep this draft");
    await check.sameDocument(documentBefore);
  });

  test(`${client} consent: cancel → deny without approval`, async ({ page }) => {
    const check = new ReauthorizationAssert(page);
    const fixture = await mockConsent(page, client);
    await navigateConsent(page);
    await page.getByRole("button", { name: "Deny", exact: true }).click();
    await check.deniedOnly(fixture);

  });
}

test("independent settings: refresh preserves rename draft → rename/revoke only selected entry", async ({ page, appShell }, testInfo) => {
    const check = new ReauthorizationAssert(page);
  const fixture = await mockIndependentSettings(page);
  await appShell.actions.navigateToRoute("/settings/ai-connectors?section=connections");
  const card = page.getByTestId("ai-connector-conn-chatgpt-second");
  await card.getByRole("button", { name: "Rename", exact: true }).click();
  await card.getByLabel("Connection name", { exact: true }).fill("Draft preserved");
  const input = await card.getByLabel("Connection name", { exact: true }).elementHandle();
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const reads = fixture.summaryReads();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await check.refreshed(fixture.summaryReads, reads);
  await check.renameDraft("Draft preserved");
  await check.inputMounted(input!);
  await check.sameDocument(timeOrigin);
  await card.getByRole("button", { name: "Save name", exact: true }).click();
  await check.renamed("Draft preserved");
  check.mutationEquals(fixture.mutations[0], { id: "conn-chatgpt-second", body: { displayName: "Draft preserved" } });
  await check.unrelatedVisible();
  await assertNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("independent-settings-desktop.png"), fullPage: true, animations: "disabled" });
  page.once("dialog", dialog => dialog.accept());
  await card.getByRole("button", { name: "Revoke", exact: true }).click();
  await check.selectedGone();
  await check.unrelatedVisible();
  check.mutationEquals(fixture.mutations[1], { id: "conn-chatgpt-second" });
});

test("settings refresh: history filter remains while data refreshes", async ({ page, appShell }) => {
    const check = new ReauthorizationAssert(page);
  const fixture = await mockIndependentSettings(page);
  await appShell.actions.navigateToRoute("/settings/ai-connectors?section=history");
  const filter = page.getByTestId("ai-connectors-history-search");
  await filter.fill("Claude");
  const reads = fixture.summaryReads();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await check.refreshed(fixture.summaryReads, reads);
  await check.historyFilterPreserved();

});
