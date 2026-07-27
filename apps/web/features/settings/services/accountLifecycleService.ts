import type {
  AccountDto,
  AccountLifecycleMutationResponseDto,
} from "@vakwen/shared-types";
import { deleteJson, getJson, postJson } from "../../../lib/api";

/**
 * ui-enhancement (2026-05-13) — account soft-delete / restore /
 * permanent-purge lifecycle API client. Extracted into its own service
 * module (separate from `settingsService.ts`) per the
 * `.claude/rules/agent-team-workflow.md` "QA's TDD-red imports can drive
 * Implementer extraction" rule — Senior QA's spec imports from this
 * canonical path.
 *
 * Companion server-side surface lives in `apps/api/src/routes/registerRoutes.ts`.
 */
export type SoftDeletedAccountDto = AccountDto & { deletedAt: string };

export type SoftDeleteAccountResponse = AccountLifecycleMutationResponseDto;
export type RestoreAccountResponse = AccountLifecycleMutationResponseDto;
export type PermanentDeleteAccountResponse = AccountLifecycleMutationResponseDto;

/**
 * Soft-delete an account. Per architect-design §6, the route stamps
 * `accounts.deleted_at = NOW()`, returns the ISO timestamp, and emits
 * `account_soft_deleted` SSE.
 */
export async function softDeleteAccount(
  accountId: string,
): Promise<SoftDeleteAccountResponse> {
  return deleteJson<SoftDeleteAccountResponse>(
    `/accounts/${encodeURIComponent(accountId)}`,
  );
}

/**
 * Restore a soft-deleted account. On active-name collision the route
 * returns the auto-renamed `finalName` (`{name} (restored)`, escalating
 * to `(restored 2)`, ...). Emits `account_restored` SSE.
 */
export async function restoreAccount(
  accountId: string,
): Promise<RestoreAccountResponse> {
  return postJson<RestoreAccountResponse>(
    `/accounts/${encodeURIComponent(accountId)}/restore`,
    {},
  );
}

/**
 * Typed-name-confirmed permanent purge of an account. The body's
 * `confirmationName` MUST equal the account name; route throws
 * `confirmation_name_mismatch` (400) otherwise. Skips the grace window
 * — also works on still-active accounts (the "Permanently delete now"
 * UX). Emits `account_hard_purged` SSE.
 */
export async function permanentlyDeleteAccount(
  accountId: string,
  confirmationName: string,
): Promise<PermanentDeleteAccountResponse> {
  return postJson<PermanentDeleteAccountResponse>(
    `/accounts/${encodeURIComponent(accountId)}/purge`,
    { confirmationName },
  );
}

/**
 * List soft-deleted accounts owned by the current user, ordered by
 * `deletedAt` DESC. Powers the "Recently deleted" subsection under
 * Settings → Accounts. Re-fetched on `account_soft_deleted`,
 * `account_restored`, and `account_hard_purged` SSE events.
 */
export async function fetchSoftDeletedAccounts(): Promise<SoftDeletedAccountDto[]> {
  return getJson<SoftDeletedAccountDto[]>("/accounts/deleted");
}
