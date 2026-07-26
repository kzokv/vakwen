import { test } from "@vakwen/test-e2e/fixtures/appPages";
import {
  seedAccountForUser,
  seedPendingShareFromAdmin,
  seedResolvedShareFromAdmin,
  seedUser,
  switchIdentity,
  updateActiveShareCapabilities,
} from "./helpers/sharing";

test.describe("sharing delegated capabilities", () => {
  test("[sharing permissions]: owner edits active and pending delegated permissions", async ({
    appShell,
    page,
    sharing,
    testUser,
  }) => {
    const grantee = await seedUser({
      sub: "e2e-delegated-permissions-grantee-sub",
      email: "delegated-permissions-grantee@example.com",
      name: "Delegated Permissions Grantee",
      role: "viewer",
    });
    const { shareId } = await seedResolvedShareFromAdmin(grantee.email, testUser.userId);
    await updateActiveShareCapabilities(shareId, testUser.userId, ["portfolio:mcp_read"]);
    const pending = await seedPendingShareFromAdmin(
      "delegated-permissions-pending@example.com",
      testUser.userId,
      ["portfolio:mcp_read"],
    );

    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();

    await page.getByTestId(`sharing-edit-permissions-${shareId}`).click();
    await appShell.assert.mxAssertTruthy(
      await page.getByTestId("edit-share-permissions-dialog").isVisible(),
      "edit share permissions dialog is visible",
    );
    await page.getByTestId("edit-share-capability-account:manage").click();
    await page.getByTestId("edit-share-capability-transaction:write").click();
    await page.getByTestId("edit-share-capability-dividend:write").click();
    await Promise.all([
      page.waitForResponse((response) =>
        response.request().method() === "PATCH"
        && response.url().includes(`/shares/${shareId}/capabilities`)
        && response.ok(),
      ),
      page.getByTestId("edit-share-permissions-save").click(),
    ]);
    await page.getByTestId("edit-share-permissions-dialog").waitFor({ state: "hidden" });
    const activeRowText = await page.getByTestId(`sharing-outbound-row-${shareId}`).textContent();
    await appShell.assert.mxAssertTruthy(
      /Manage accounts and fee settings/.test(activeRowText ?? ""),
      "active share row shows account manage capability",
    );
    await appShell.assert.mxAssertTruthy(
      /Post, update, and delete confirmed transactions/.test(activeRowText ?? ""),
      "active share row shows transaction write capability",
    );
    await appShell.assert.mxAssertTruthy(
      /Write dividends and related accounting adjustments/.test(activeRowText ?? ""),
      "active share row shows dividend write capability",
    );

    await page.getByTestId(`sharing-edit-permissions-${pending.inviteCode}`).scrollIntoViewIfNeeded();
    await page.getByTestId(`sharing-edit-permissions-${pending.inviteCode}`).click();
    await page.getByTestId("edit-share-capability-account:manage").click();
    await Promise.all([
      page.waitForResponse((response) =>
        response.request().method() === "PATCH"
        && response.url().includes(`/shares/pending/${pending.inviteCode}/capabilities`)
        && response.ok(),
      ),
      page.getByTestId("edit-share-permissions-save").click(),
    ]);
    const pendingRowText = await page.getByTestId(`sharing-outbound-row-${pending.inviteCode}`).textContent();
    await appShell.assert.mxAssertTruthy(
      /Manage accounts and fee settings/.test(pendingRowText ?? ""),
      "pending share row shows account manage capability",
    );
  });

  test("[shared dividends]: dividend review drawer is read-only until dividend:write is delegated, then edits the owner's posting", async ({
    appShell,
    dividendReview,
    page,
    sharing,
    testUser,
  }) => {
    const posted = await dividendReview.arrange.seedPostedDividend({
      ticker: "7795",
      exDividendDate: "2026-06-01",
      paymentDate: "2026-07-01",
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    const grantee = await seedUser({
      sub: "e2e-shared-dividend-grantee-sub",
      email: "shared-dividend-grantee@example.com",
      name: "Shared Dividend Grantee",
      role: "viewer",
    });
    const { shareId } = await seedResolvedShareFromAdmin(grantee.email, testUser.userId);

    await switchIdentity(page, { userId: grantee.userId, role: "viewer" });
    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();
    await sharing.actions.navigateToInboundShares();
    await page.getByTestId(`sharing-open-dashboard-${shareId}`).click();
    await appShell.assert.appIsReady();

    const unexpectedReadFailures: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400) unexpectedReadFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    });
    const reviewResponse = page.waitForResponse((response) =>
      response.request().method() === "GET"
      && response.url().includes("/portfolio/dividends/review"));
    await dividendReview.actions.navigateToReview();
    await appShell.assert.mxAssertEqual((await reviewResponse).status(), 200, "delegated review data loads");
    await dividendReview.actions.clickRow(posted.dividendLedgerEntryId);
    await page.getByText("You can review this dividend, but dividend write permission is required to make changes.").waitFor();
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("dividend-posting-form").count(),
      0,
      "delegate without dividend:write sees a read-only drawer",
    );
    await appShell.assert.mxAssertEqual(
      unexpectedReadFailures.join("\n"),
      "",
      "read-only dividend review does not issue forbidden background requests",
    );

    await updateActiveShareCapabilities(shareId, testUser.userId, ["portfolio:mcp_read", "dividend:write"]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await appShell.assert.appIsReady();
    await dividendReview.actions.navigateToReview();
    await dividendReview.actions.clickRow(posted.dividendLedgerEntryId);
    await page.getByTestId("dividend-received-cash").fill("109");
    const saveResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && response.url().endsWith("/portfolio/dividends/postings"));
    await page.getByTestId("dividend-save").click();
    await appShell.assert.mxAssertEqual((await saveResponse).status(), 200, "delegated dividend edit succeeds");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  });

  test("[shared transactions]: transaction form is gated by transaction:write", async ({
    appShell,
    page,
    sharing,
    testUser,
    transactions,
  }) => {
    const grantee = await seedUser({
      sub: "e2e-shared-transaction-grantee-sub",
      email: "shared-transaction-grantee@example.com",
      name: "Shared Transaction Grantee",
      role: "viewer",
    });
    const { shareId } = await seedResolvedShareFromAdmin(grantee.email, testUser.userId);

    await switchIdentity(page, { userId: grantee.userId, role: "viewer" });
    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();
    await sharing.actions.navigateToInboundShares();
    await page.getByTestId(`sharing-open-dashboard-${shareId}`).click();
    await appShell.assert.appIsReady();

    await transactions.actions.navigateToTransactions();
    await transactions.assert.readOnlyMessageIsVisible();

    await updateActiveShareCapabilities(shareId, testUser.userId, ["portfolio:mcp_read", "transaction:write"]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await appShell.assert.appIsReady();

    await transactions.actions.navigateToTransactions();
    await appShell.assert.mxAssertTruthy(
      await page.getByTestId("tx-submit-button").isVisible(),
      "transaction submit button is visible with transaction:write",
    );
  });

  test("[shared accounts]: account management is gated by account:manage and never exposes hard purge", async ({
    appShell,
    page,
    settings,
    sharing,
    testUser,
  }) => {
    const account = await seedAccountForUser(testUser.userId, {
      name: "Delegated Account Scope",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    const grantee = await seedUser({
      sub: "e2e-shared-account-grantee-sub",
      email: "shared-account-grantee@example.com",
      name: "Shared Account Grantee",
      role: "viewer",
    });
    const { shareId } = await seedResolvedShareFromAdmin(grantee.email, testUser.userId);

    await switchIdentity(page, { userId: grantee.userId, role: "viewer" });
    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();
    await sharing.actions.navigateToInboundShares();
    await page.getByTestId(`sharing-open-dashboard-${shareId}`).click();
    await appShell.assert.appIsReady();

    await appShell.actions.openSettingsSection("accounts");
    await page.getByTestId("accounts-shared-readonly-note").waitFor({ state: "visible" });
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("account-create-form").count(),
      0,
      "account create flow is hidden without account:manage",
    );
    await appShell.assert.mxAssertEqual(
      await page.getByTestId(`account-delete-btn-${account.id}`).isDisabled(),
      true,
      "account delete button is disabled without account:manage",
    );

    await updateActiveShareCapabilities(shareId, testUser.userId, ["portfolio:mcp_read", "account:manage"]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await appShell.assert.appIsReady();

    await appShell.actions.openSettingsSection("accounts");
    await settings.actions.openAccountCreateFlow();
    await settings.assert.accountCreateFormIsVisible();
    await settings.actions.fillAccountCreateName("Delegated Created Account");
    await page.evaluate(() => {
      const button = document.querySelector('[data-testid="account-create-continue"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Account create review control is unavailable");
      }
      button.click();
    });
    await page.getByTestId("account-create-submit").waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      await page.getByTestId("account-create-submit").isEnabled(),
      "account create submit is enabled with account:manage",
    );
    await page.keyboard.press("Escape");
    await page.getByTestId("ui-drawer").waitFor({ state: "hidden" });
    await settings.assert.accountDeleteButtonIsVisible(account.id);

    await settings.actions.clickAccountDeleteButton(account.id);
    await settings.assert.softDeleteModalIsVisible();
    await settings.actions.confirmSoftDelete();
    await settings.assert.recentlyDeletedRowIsVisible(account.id);
    await settings.assert.recentlyDeletedRestoreButtonIsVisible(account.id);
    await appShell.assert.mxAssertEqual(
      await page.getByTestId(`recently-deleted-purge-btn-${account.id}`).count(),
      0,
      "hard purge is hidden in shared account-management context",
    );
  });
});
