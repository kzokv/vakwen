/**
 * ui-enhancement — HTTP API tests for POST /accounts/:id/restore.
 *
 * Response shape: authoritative lifecycle delta with `{ accountId, account,
 * finalName, capabilities, reportingCurrency }`. `finalName` is the resolved name
 * after auto-rename. Body-envelope errors follow `service-error-pattern.md`
 * (`body.error`, never `body.code`).
 *
 * Auto-rename rule (`architect-design.md §4`): on restore, if an *active*
 * account already owns the same name, the restored row becomes
 * `"{originalName} (restored)"`. If that ALSO collides, try
 * `" (restored 2)"`, `" (restored 3)"`, ... up to N=20 (then 409
 * `account_restore_name_unresolvable`).
 *
 * Audit-log assertions live in suite 5 (Postgres). HTTP-side asserts the
 * response envelope + side effect via GET /accounts round-trip.
 */

import { test } from "../fixtures.js";

test.describe("POST /accounts/:id/restore (ui-enhancement)", () => {
  test("happy path: restore re-surfaces account in GET /accounts with finalName = original name", async ({
    accountsApi,
  }) => {
    // Arrange — create + soft-delete an account.
    const created = await accountsApi.actions.createAccount({
      name: "Restore Happy",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    const createdBody = (await accountsApi.arrange.body(created)) as Record<string, unknown>;
    const id = String(createdBody.id);

    const softDelete = await accountsApi.actions.softDeleteAccount(id);
    await accountsApi.assert.statusIs(softDelete, 200);

    // Act
    const response = await accountsApi.actions.restoreAccount(id);
    await accountsApi.assert.statusIs(response, 200);

    // Assert — envelope
    const respBody = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(respBody, "accountId", id);
    await accountsApi.assert.fieldEquals(respBody, "finalName", "Restore Happy");
    const restoredAccount = respBody.account as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(restoredAccount, "id", id);
    await accountsApi.assert.fieldEquals(restoredAccount, "name", "Restore Happy");
    await accountsApi.assert.fieldEquals(restoredAccount, "defaultCurrency", "TWD");
    await accountsApi.assert.mxAssertDeepEqual(respBody.capabilities, {
      configuredMarkets: ["TW"],
      configuredCurrencies: ["TWD"],
    });
    await accountsApi.assert.mxAssertDeepEqual(respBody.reportingCurrency, {
      requested: null,
      effective: "TWD",
      reason: null,
    });

    // Assert — GET /accounts surfaces the restored row again
    const listResponse = await accountsApi.actions.listAccounts();
    const accounts = await accountsApi.arrange.accounts(listResponse);
    const found = accounts.find((a) => a["id"] === id);
    if (!found) {
      throw new Error(`Expected GET /accounts to surface restored account ${id}`);
    }
    await accountsApi.assert.fieldEquals(found, "name", "Restore Happy");
  });

  test("auto-rename on single collision: restore appends ' (restored)' suffix", async ({
    accountsApi,
  }) => {
    // Arrange — create A, soft-delete A, create B with the same name.
    const a = await accountsApi.actions.createAccount({
      name: "Collision Test",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    const aBody = (await accountsApi.arrange.body(a)) as Record<string, unknown>;
    const aId = String(aBody.id);

    await accountsApi.actions.softDeleteAccount(aId);

    const b = await accountsApi.actions.createAccount({
      name: "Collision Test",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(b, 200);

    // Act — restore A; B already owns "Collision Test".
    const response = await accountsApi.actions.restoreAccount(aId);
    await accountsApi.assert.statusIs(response, 200);

    // Assert — finalName carries the renamed suffix.
    const respBody = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(respBody, "finalName", "Collision Test (restored)");
    const restoredAccount = respBody.account as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(restoredAccount, "id", aId);
    await accountsApi.assert.fieldEquals(restoredAccount, "name", "Collision Test (restored)");
    await accountsApi.assert.fieldEquals(restoredAccount, "defaultCurrency", "USD");
    await accountsApi.assert.mxAssertDeepEqual(respBody.capabilities, {
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    });
    await accountsApi.assert.mxAssertDeepEqual(respBody.reportingCurrency, {
      requested: null,
      effective: "TWD",
      reason: null,
    });

    // Assert — both rows are visible with distinct names.
    const listResponse = await accountsApi.actions.listAccounts();
    const accounts = await accountsApi.arrange.accounts(listResponse);
    const restored = accounts.find((acct) => acct["id"] === aId);
    if (!restored) throw new Error(`Expected restored account ${aId} in list`);
    await accountsApi.assert.fieldEquals(restored, "name", "Collision Test (restored)");
  });

  test("unknown id returns 404 with body.error='account_not_found'", async ({
    accountsApi,
  }) => {
    const response = await accountsApi.actions.restoreAccount("acc-missing-restore");
    await accountsApi.assert.statusIs(response, 404);
    const body = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(body, "error", "account_not_found");
  });
});
