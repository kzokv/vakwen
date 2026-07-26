import { request as apiRequest, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import type { ShareCapability } from "@vakwen/shared-types";

const E2E_USER_COOKIE = "tw_e2e_user";
const E2E_USER_ROLE_COOKIE = "tw_e2e_user_role";

function buildMockIdToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    email_verified: true,
    iss: "https://accounts.google.com",
    aud: TestEnv.oauth.clientId,
    iat: now,
    exp: now + 3600,
    ...claims,
  };
  return `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.mock-signature`;
}

/**
 * Run a callback with an isolated APIRequestContext. This is critical for seed
 * helpers that talk directly to the API: Playwright's test-scoped `request`
 * fixture shares its cookie jar with `page.context()`, so session cookies
 * minted by `/__e2e/oauth-session` or any endpoint that issues Set-Cookie leak
 * into subsequent HTTP calls. The API's hydrateAuthContext then parses that
 * cookie and overrides any `x-user-id` header, producing 403s for admin-scoped
 * calls. A fresh context starts with an empty jar and is disposed on exit.
 */
async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

export interface TSeededUser {
  userId: string;
  email: string;
}

export interface TSeededTransactionInput {
  accountId?: string;
  ticker: string;
  quantity?: number;
  unitPrice?: number;
  priceCurrency?: string;
  tradeDate?: string;
  type?: "BUY" | "SELL";
}

export interface TSeededAccount {
  id: string;
  userId: string;
  name: string;
  feeProfileId: string;
  defaultCurrency: "TWD" | "USD" | "AUD" | "KRW" | "JPY";
  accountType: "broker" | "bank" | "wallet";
}

/**
 * Creates a real `users` row with a known email via the /__e2e/oauth-session
 * endpoint. Uses a fresh APIRequestContext so the minted session cookie is
 * discarded on return — prevents cookie-jar leakage into subsequent seed calls.
 */
export async function seedUser(options: {
  email: string;
  name: string;
  sub: string;
  role?: "admin" | "member" | "viewer";
}): Promise<TSeededUser> {
  const role = options.role ?? "member";
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(
      new URL(`/__e2e/oauth-session?role=${role}`, TestEnv.apiBaseUrl).href,
      {
        data: {
          id_token: buildMockIdToken({
            sub: options.sub,
            email: options.email,
            name: options.name,
          }),
        },
      },
    );

    if (!response.ok()) {
      throw new Error(`oauth-session seed failed: ${response.status()} ${await response.text()}`);
    }

    const body = (await response.json()) as { userId: string };
    return { userId: body.userId, email: options.email };
  });
}

export async function softDeleteAllActiveAccountsForUser(userId: string): Promise<void> {
  await withFreshContext(async (ctx) => {
    const accountsResponse = await ctx.get(new URL("/accounts", TestEnv.apiBaseUrl).href, {
      headers: { "x-user-id": userId },
    });
    if (!accountsResponse.ok()) {
      throw new Error(
        `list accounts for zero-state seed failed: ${accountsResponse.status()} ${await accountsResponse.text()}`,
      );
    }
    const accounts = await accountsResponse.json() as Array<{ id: string }>;
    for (const account of accounts) {
      const response = await ctx.delete(
        new URL(`/accounts/${account.id}`, TestEnv.apiBaseUrl).href,
        { headers: { "x-user-id": userId } },
      );
      if (!response.ok()) {
        throw new Error(
          `zero-state account delete failed: ${response.status()} ${await response.text()}`,
        );
      }
    }
  });
}

export async function seedUserPreferencesForUser(
  userId: string,
  preferences: Record<string, unknown>,
): Promise<void> {
  await withFreshContext(async (ctx) => {
    const response = await ctx.post(
      new URL("/__e2e/seed-user-preferences", TestEnv.apiBaseUrl).href,
      {
        headers: { "x-user-id": userId },
        data: { preferences },
      },
    );
    if (!response.ok()) {
      throw new Error(
        `seed user preferences failed: ${response.status()} ${await response.text()}`,
      );
    }
  });
}

/**
 * Seed an active share from the default dev_bypass admin (user-1) to the given
 * grantee. Throws if the grantee email is not a known user. Uses a fresh
 * context so the caller's cookies (including any prior seeded user's session)
 * cannot override `x-user-id: user-1`.
 */
export async function seedResolvedShareFromAdmin(
  granteeEmail: string,
  ownerUserId: string = "user-1",
): Promise<{ shareId: string }> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(new URL("/shares", TestEnv.apiBaseUrl).href, {
      data: { email: granteeEmail },
      headers: { "x-user-id": ownerUserId },
    });
    if (!response.ok()) {
      throw new Error(`seed share failed: ${response.status()} ${await response.text()}`);
    }
    const body = (await response.json()) as
      | { type: "resolved"; share: { id: string } }
      | { type: "pending"; invite: { code: string } };
    if (body.type !== "resolved") {
      throw new Error(`expected resolved share for known grantee email, got pending: ${granteeEmail}`);
    }
    return { shareId: body.share.id };
  });
}

export async function seedPendingShareFromAdmin(
  email: string,
  ownerUserId: string = "user-1",
  capabilities: ShareCapability[] = [],
): Promise<{ inviteCode: string }> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(new URL("/shares", TestEnv.apiBaseUrl).href, {
      data: { email, capabilities },
      headers: { "x-user-id": ownerUserId },
    });
    if (!response.ok()) {
      throw new Error(`seed pending share failed: ${response.status()} ${await response.text()}`);
    }
    const body = (await response.json()) as
      | { type: "resolved"; share: { id: string } }
      | { type: "pending"; invite: { code: string } };
    if (body.type !== "pending") {
      throw new Error(`expected pending share for unknown grantee email, got resolved: ${email}`);
    }
    return { inviteCode: body.invite.code };
  });
}

export async function updateActiveShareCapabilities(
  shareId: string,
  ownerUserId: string,
  capabilities: ShareCapability[],
): Promise<void> {
  await withFreshContext(async (ctx) => {
    const response = await ctx.patch(new URL(`/shares/${shareId}/capabilities`, TestEnv.apiBaseUrl).href, {
      data: { capabilities },
      headers: { "x-user-id": ownerUserId },
    });
    if (!response.ok()) {
      throw new Error(`update active share capabilities failed: ${response.status()} ${await response.text()}`);
    }
  });
}

export async function updatePendingShareCapabilities(
  inviteCode: string,
  ownerUserId: string,
  capabilities: ShareCapability[],
): Promise<void> {
  await withFreshContext(async (ctx) => {
    const response = await ctx.patch(new URL(`/shares/pending/${inviteCode}/capabilities`, TestEnv.apiBaseUrl).href, {
      data: { capabilities },
      headers: { "x-user-id": ownerUserId },
    });
    if (!response.ok()) {
      throw new Error(`update pending share capabilities failed: ${response.status()} ${await response.text()}`);
    }
  });
}

export async function seedAccountForUser(
  userId: string,
  input: {
    name: string;
    defaultCurrency?: TSeededAccount["defaultCurrency"];
    accountType?: TSeededAccount["accountType"];
  },
): Promise<TSeededAccount> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(new URL("/accounts", TestEnv.apiBaseUrl).href, {
      data: {
        name: input.name,
        defaultCurrency: input.defaultCurrency ?? "TWD",
        accountType: input.accountType ?? "broker",
      },
      headers: { "x-user-id": userId },
    });
    if (!response.ok()) {
      throw new Error(`seed account failed: ${response.status()} ${await response.text()}`);
    }
    return (await response.json()) as TSeededAccount;
  });
}

export async function seedTransactionForUser(
  userId: string,
  input: TSeededTransactionInput,
): Promise<void> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(new URL("/portfolio/transactions", TestEnv.apiBaseUrl).href, {
      data: {
        accountId: input.accountId ?? "acc-1",
        ticker: input.ticker,
        // KZO-169 (G4): existing TW switcher fixture stamps marketCode.
        marketCode: "TW",
        quantity: input.quantity ?? 100,
        unitPrice: input.unitPrice ?? 100,
        priceCurrency: input.priceCurrency ?? "TWD",
        tradeDate: input.tradeDate ?? "2026-01-02",
        type: input.type ?? "BUY",
        isDayTrade: false,
      },
      headers: {
        "x-user-id": userId,
        // Unique per invocation so Playwright test retries don't collide with
        // the prior attempt's already-claimed key (which 409s as
        // duplicate_idempotency_key and breaks the retry before the UI even
        // renders). The helper is a seed, not a dedup exercise — losing
        // idempotency semantics here is intentional.
        "idempotency-key": `e2e-switcher-${userId}-${input.ticker}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      },
    });
    if (!response.ok()) {
      throw new Error(`seed transaction failed: ${response.status()} ${await response.text()}`);
    }
  });
}

export async function revokeShareAsOwner(shareId: string, ownerUserId: string): Promise<void> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.delete(new URL(`/shares/${shareId}`, TestEnv.apiBaseUrl).href, {
      headers: { "x-user-id": ownerUserId },
    });
    if (!response.ok()) {
      throw new Error(`revoke share failed: ${response.status()} ${await response.text()}`);
    }
  });
}

/**
 * Swap the browser's dev_bypass identity to a specific userId + role.
 * Clears existing cookies and plants tw_e2e_user + tw_e2e_user_role.
 * `x-user-role` forwarding from tw_e2e_user_role cookie is wired in apps/web/lib/api.ts.
 */
export async function switchIdentity(
  context: BrowserContext | Page,
  options: { userId: string; role: "admin" | "member" | "viewer" },
): Promise<void> {
  const ctx = "context" in context ? context.context() : context;
  await ctx.clearCookies();
  const urlBase = new URL("/", TestEnv.appBaseUrl).href;
  await ctx.addCookies([
    { name: E2E_USER_COOKIE, value: encodeURIComponent(options.userId), url: urlBase },
    { name: E2E_USER_ROLE_COOKIE, value: options.role, url: urlBase },
  ]);
}
