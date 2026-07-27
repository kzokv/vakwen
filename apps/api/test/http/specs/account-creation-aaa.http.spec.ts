/**
 * KZO-179 — HTTP API tests for POST /accounts.
 *
 * Covers the route's happy paths + Zod validation rejections + GET round-trip.
 *
 * NOT covered here (placement rationale):
 *   - 409 duplicate-name: routed to suite 5
 *     (`apps/api/test/integration/account-creation-uniqueness.integration.test.ts`)
 *     per `test-placement-persistence-backend.md` + design memo §6. The
 *     in-memory pre-check would technically fire here, but keeping the 409
 *     placement Postgres-side preserves the canonical
 *     "DB-enforced semantics live in suite 5" signal that the parent
 *     KZO-167 ticket established.
 *   - Form rendering / preview chip: suite 3 (web-unit).
 *   - Golden-path UI flow: suite 6 (E2E dev_bypass).
 *
 * Body-envelope contract (`service-error-pattern.md`): the route's
 * `routeError(...)` envelope serialises as `{ error: "<code>", message: "<text>" }`.
 * Reads use `body.error` for the machine-readable code; never `body.code`.
 *
 * KZO-183: account creation auto-seeds a fresh default fee profile owned by
 * the new account. Tests assert the relationship, not a deterministic id.
 */

import { test } from "../fixtures.js";

function expectAccountMutationEnvelope(
  body: Record<string, unknown>,
  expected: { name: string; defaultCurrency: string; accountType: string; capabilityMarkets: string[]; capabilityCurrencies: string[]; effectiveReportingCurrency: string },
) {
  const account = body.account as Record<string, unknown>;
  const feeProfile = body.feeProfile as Record<string, unknown>;
  const capabilities = body.capabilities as Record<string, unknown>;
  const reportingCurrency = body.reportingCurrency as Record<string, unknown>;
  const valid = typeof body.id === "string"
    && typeof body.userId === "string"
    && typeof body.feeProfileId === "string"
    && body.name === expected.name
    && body.defaultCurrency === expected.defaultCurrency
    && body.accountType === expected.accountType
    && account.id === body.id
    && account.userId === body.userId
    && account.name === expected.name
    && account.defaultCurrency === expected.defaultCurrency
    && account.accountType === expected.accountType
    && account.feeProfileId === body.feeProfileId
    && feeProfile.id === body.feeProfileId
    && feeProfile.accountId === body.id
    && feeProfile.commissionCurrency === expected.defaultCurrency
    && JSON.stringify(capabilities.configuredMarkets) === JSON.stringify(expected.capabilityMarkets)
    && JSON.stringify(capabilities.configuredCurrencies) === JSON.stringify(expected.capabilityCurrencies)
    && reportingCurrency.requested === "TWD"
    && reportingCurrency.effective === expected.effectiveReportingCurrency
    && reportingCurrency.reason === null;
  if (!valid) {
    throw new Error(`Unexpected account mutation envelope: ${JSON.stringify(body)}`);
  }
}

test.describe("POST /accounts (KZO-179 / KZO-183)", () => {
  // ── Happy path + DTO shape ─────────────────────────────────────────────────

  test("happy path: returns 200 with authoritative mutation envelope and resolves the default fee profile", async ({
    accountsApi,
    feeProfilesApi,
  }) => {
    const response = await accountsApi.actions.createAccount({
      name: "USD Brokerage",
      defaultCurrency: "USD",
      accountType: "bank",
    });
    await accountsApi.assert.statusIs(response, 200);

    const body = (await accountsApi.arrange.body(response)) as Record<string, unknown>;

    expectAccountMutationEnvelope(body, {
      name: "USD Brokerage",
      defaultCurrency: "USD",
      accountType: "bank",
      capabilityMarkets: ["TW", "US"],
      capabilityCurrencies: ["TWD", "USD"],
      effectiveReportingCurrency: "TWD",
    });

    const profilesResponse = await feeProfilesApi.actions.listFeeProfilesForAccount(String(body.id));
    await feeProfilesApi.assert.statusIs(profilesResponse, 200);
    const profiles = await feeProfilesApi.arrange.feeProfiles(profilesResponse);
    if (profiles.length !== 1) {
      throw new Error(`Expected exactly one auto-seeded profile, got ${profiles.length}`);
    }

    await feeProfilesApi.assert.fieldEquals(profiles[0]!, "id", body.feeProfileId);
    await feeProfilesApi.assert.fieldEquals(profiles[0]!, "accountId", body.id);
    await feeProfilesApi.assert.fieldEquals(profiles[0]!, "commissionCurrency", "USD");
  });

  // ── Validation rejections (Zod 400) ────────────────────────────────────────

  test("validation: empty name → 400", async ({ accountsApi }) => {
    const response = await accountsApi.actions.createAccount({
      name: "",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(response, 400);
  });

  test("validation: name longer than 80 chars → 400", async ({ accountsApi }) => {
    const response = await accountsApi.actions.createAccount({
      name: "A".repeat(81),
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(response, 400);
  });

  test("validation: defaultCurrency='EUR' (not in enum) → 400", async ({ accountsApi }) => {
    const response = await accountsApi.actions.createAccount({
      name: "Bad Currency",
      defaultCurrency: "EUR",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(response, 400);
  });

  test("validation: accountType='savings' (not in enum) → 400", async ({ accountsApi }) => {
    const response = await accountsApi.actions.createAccount({
      name: "Bad Type",
      defaultCurrency: "TWD",
      accountType: "savings",
    });
    await accountsApi.assert.statusIs(response, 400);
  });

  test("validation: missing defaultCurrency → 400", async ({ accountsApi }) => {
    const response = await accountsApi.actions.createAccount({
      name: "No Currency",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(response, 400);
  });

  // ── Trim semantics (Zod .trim() chain at registerRoutes.ts:2504) ───────────

  test("trim: leading/trailing whitespace is stripped before persistence", async ({
    accountsApi,
  }) => {
    const response = await accountsApi.actions.createAccount({
      name: "  Padded Account  ",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(response, 200);

    const body = (await accountsApi.arrange.body(response)) as Record<string, unknown>;
    expectAccountMutationEnvelope(body, {
      name: "Padded Account",
      defaultCurrency: "TWD",
      accountType: "broker",
      capabilityMarkets: ["TW"],
      capabilityCurrencies: ["TWD"],
      effectiveReportingCurrency: "TWD",
    });
  });

  // ── Round-trip via GET /accounts ───────────────────────────────────────────

  test("GET /accounts after POST reflects the new account with the same id and fields", async ({
    accountsApi,
  }) => {
    const createResponse = await accountsApi.actions.createAccount({
      name: "Round Trip",
      defaultCurrency: "AUD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(createResponse, 200);
    const created = (await accountsApi.arrange.body(createResponse)) as Record<string, unknown>;
    const newId = created.id;
    if (typeof newId !== "string") {
      throw new Error("Expected created account id to be a string");
    }

    const listResponse = await accountsApi.actions.listAccounts();
    await accountsApi.assert.statusIs(listResponse, 200);
    const accounts = await accountsApi.arrange.accounts(listResponse);

    const found = accounts.find((account) => account["id"] === newId);
    if (!found) {
      throw new Error(`Expected GET /accounts to include the new account ${newId}`);
    }
    await accountsApi.assert.fieldEquals(found, "name", "Round Trip");
    await accountsApi.assert.fieldEquals(found, "defaultCurrency", "AUD");
    await accountsApi.assert.fieldEquals(found, "accountType", "broker");
  });
});
