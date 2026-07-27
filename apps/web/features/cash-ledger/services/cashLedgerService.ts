import type {
  AccountDto,
  AccountMutationResponseDto,
  AccountDefaultCurrency,
  AccountType,
} from "@vakwen/shared-types";
import { getJson, postJson } from "../../../lib/api";
import type { CashLedgerListResponse, CashLedgerQuery } from "../types";

export interface AccountLiveBalance {
  currency: string;
  amount: number;
}

export type AccountWithLiveBalance = AccountDto & {
  liveBalance?: AccountLiveBalance[];
};

/**
 * KZO-179 / KZO-183: request body for `POST /accounts`. Mirrors the Zod
 * schema in `apps/api/src/routes/registerRoutes.ts`. `feeProfileId` was
 * dropped in KZO-183 — the route auto-seeds an account-scoped default
 * profile in the same transaction (per design D7 / scope decision 31).
 */
export interface CreateAccountInput {
  name: string;
  defaultCurrency: AccountDefaultCurrency;
  accountType: AccountType;
}

export async function fetchCashLedgerEntries(
  query: CashLedgerQuery = {},
): Promise<CashLedgerListResponse> {
  const params = new URLSearchParams();

  if (query.fromEntryDate) params.set("fromEntryDate", query.fromEntryDate);
  if (query.toEntryDate) params.set("toEntryDate", query.toEntryDate);
  if (query.accountId) params.set("accountId", query.accountId);
  if (query.entryType) {
    for (const t of query.entryType) {
      params.append("entryType", t);
    }
  }
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);

  const qs = params.toString();
  return getJson<CashLedgerListResponse>(`/portfolio/cash-ledger${qs ? `?${qs}` : ""}`);
}

/**
 * KZO-167: fetch the user's accounts so the dropdown and summary chips can
 * render `name (currency · type)` instead of the raw account ID. Falls back
 * to the raw ID rendering until this resolves.
 */
export async function fetchAccounts(
  opts: { includeBalances?: boolean } = {},
): Promise<AccountWithLiveBalance[]> {
  const params = new URLSearchParams();
  if (opts.includeBalances) params.set("includeBalances", "true");
  const qs = params.toString();
  return getJson<AccountWithLiveBalance[]>(`/accounts${qs ? `?${qs}` : ""}`);
}

/**
 * KZO-179: create a new account via `POST /accounts`. Returns the bare
 * `AccountDto` (per scope-todo D7). The route validates name uniqueness
 * (per-user, case-sensitive) and resolves the fee profile when omitted.
 *
 * Caller is expected to surface inline errors:
 * - 409 `account_name_in_use` → "An account with that name already exists."
 * - 500 / generic → "Could not create account. Please try again."
 *
 * The shared `postJson` helper throws `ApiError` for non-2xx responses;
 * callers should `.catch` and read `error.code` / `error.status`.
 */
export async function createAccount(input: CreateAccountInput): Promise<AccountMutationResponseDto> {
  return postJson<AccountMutationResponseDto>("/accounts", input);
}
