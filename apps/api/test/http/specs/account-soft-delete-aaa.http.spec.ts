/**
 * ui-enhancement — HTTP API tests for DELETE /accounts/:id (soft-delete).
 *
 * Body-envelope contract (`service-error-pattern.md`): route's `routeError(...)`
 * serialises as `{ error: "<code>", message: "<text>" }`. Read `body.error`,
 * never `body.code`.
 *
 * Idempotency: a second soft-delete on the same account returns 200 with the
 * SAME `deletedAt` ISO string (resolver is idempotent per design §4).
 *
 * Audit-log assertions live in suite 5 (Postgres-backed integration); HTTP-side
 * only asserts the response envelope + the side effect via GET round-trips.
 */

import { test } from "../fixtures.js";

test.describe("DELETE /accounts/:id (ui-enhancement soft-delete)", () => {
  test("happy path: returns 200 with the authoritative lifecycle delta and hides the row from GET /accounts", async ({
    accountsApi,
  }) => {
    // Arrange — create a fresh account so we don't poison the seeded `acc-1`.
    const created = await accountsApi.actions.createAccount({
      name: "Soft Delete Target",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(created, 200);
    const body = (await accountsApi.arrange.body(created)) as Record<string, unknown>;
    const id = String(body.id);

    // Act
    const response = await accountsApi.actions.softDeleteAccount(id);
    await accountsApi.assert.statusIs(response, 200);

    // Assert — response envelope
    const respBody = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(respBody, "accountId", id);
    if (typeof respBody.deletedAt !== "string" || respBody.deletedAt.length === 0) {
      throw new Error(
        `Expected response.deletedAt to be a non-empty ISO string; got ${String(respBody.deletedAt)}`,
      );
    }
    await accountsApi.assert.fieldEquals(respBody, "finalName", null);
    const deletedAccount = respBody.account as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(deletedAccount, "id", id);
    await accountsApi.assert.fieldEquals(deletedAccount, "name", "Soft Delete Target");
    await accountsApi.assert.fieldEquals(deletedAccount, "defaultCurrency", "TWD");
    await accountsApi.assert.fieldEquals(deletedAccount, "accountType", "broker");
    await accountsApi.assert.mxAssertDeepEqual(respBody.capabilities, {
      configuredMarkets: ["TW"],
      configuredCurrencies: ["TWD"],
    });
    await accountsApi.assert.mxAssertDeepEqual(respBody.reportingCurrency, {
      requested: null,
      effective: "TWD",
      reason: null,
    });

    // Assert — GET /accounts no longer surfaces the soft-deleted row
    const listResponse = await accountsApi.actions.listAccounts();
    const accounts = await accountsApi.arrange.accounts(listResponse);
    const found = accounts.find((a) => a["id"] === id);
    if (found) {
      throw new Error(`Expected GET /accounts to omit soft-deleted account ${id}`);
    }
  });

  test("idempotent: second soft-delete returns 200 with the same deletedAt timestamp", async ({
    accountsApi,
  }) => {
    const created = await accountsApi.actions.createAccount({
      name: "Idempotent Soft Delete",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    const body = (await accountsApi.arrange.body(created)) as Record<string, unknown>;
    const id = String(body.id);

    const first = await accountsApi.actions.softDeleteAccount(id);
    await accountsApi.assert.statusIs(first, 200);
    const firstBody = (await accountsApi.arrange.body(first)) as Record<string, unknown>;
    const firstDeletedAt = String(firstBody.deletedAt);

    const second = await accountsApi.actions.softDeleteAccount(id);
    await accountsApi.assert.statusIs(second, 200);
    const secondBody = (await accountsApi.arrange.body(second)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(secondBody, "deletedAt", firstDeletedAt);
    const deletedAccount = secondBody.account as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(deletedAccount, "id", id);
    await accountsApi.assert.fieldEquals(deletedAccount, "name", "Idempotent Soft Delete");
  });

  test("unknown account id returns 404 with body.error='account_not_found'", async ({
    accountsApi,
  }) => {
    const response = await accountsApi.actions.softDeleteAccount("acc-does-not-exist");
    await accountsApi.assert.statusIs(response, 404);
    const body = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(body, "error", "account_not_found");
  });
});
