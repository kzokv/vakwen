import type {
  AccountDto,
  AccountMutationResponseDto,
  AccountType,
  FeeProfileBindingDto,
  FeeProfileDto,
  ProfileDto,
  UserSettings,
} from "@vakwen/shared-types";
import { patchJson } from "../../../lib/api";

// ui-enhancement (2026-05-13) — account soft-delete / restore /
// permanent-purge lifecycle endpoints live in `./accountLifecycleService.ts`
// (extracted per QA's TDD-red import path).

export interface SaveSettingsResponse {
  settings: UserSettings;
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
}

export interface AccountPatch {
  name?: string;
  feeProfileId?: string;
  accountType?: AccountType;
}

export async function patchAccount(
  accountId: string,
  patch: AccountPatch,
): Promise<AccountMutationResponseDto> {
  return patchJson<AccountMutationResponseDto>(`/accounts/${encodeURIComponent(accountId)}`, patch);
}

export interface FeeProfilePatch {
  name: string;
  boardCommissionRate: number;
  commissionDiscountPercent: number;
  minimumCommissionAmount: number;
  commissionCurrency: FeeProfileDto["commissionCurrency"];
  commissionRoundingMode: FeeProfileDto["commissionRoundingMode"];
  taxRoundingMode: FeeProfileDto["taxRoundingMode"];
  stockSellTaxRateBps: number;
  stockDayTradeTaxRateBps: number;
  etfSellTaxRateBps: number;
  bondEtfSellTaxRateBps: number;
  commissionChargeMode: FeeProfileDto["commissionChargeMode"];
}

export async function patchFeeProfile(profileId: string, patch: FeeProfilePatch): Promise<FeeProfileDto> {
  return patchJson<FeeProfileDto>(`/fee-profiles/${encodeURIComponent(profileId)}`, patch);
}

// ── Per-resource PATCH helpers (Phase 3d S3 / Decision #16) ─────────────────
//
// Replaces the legacy `saveFullSettings` (PUT /settings/full) omnibus call.
// Each helper targets ONE resource so auto-save + confirmed-save flows can
// commit narrow diffs without round-tripping the entire settings tree.

/**
 * Patch entries on the user-preferences JSONB column. Accepts any partial
 * shape — `null` for a key clears it. Returns the updated preferences DTO
 * (whatever shape the backend uses; callers typically don't read it back
 * because they already hold the optimistic value).
 */
export async function patchUserPreferences<TResponse = unknown>(
  patch: Record<string, unknown>,
): Promise<TResponse> {
  return patchJson<TResponse>("/user-preferences", patch, { contextScope: "session" });
}

/**
 * Patch the profile. Backend extension (Phase 3d S7) accepts:
 *   email?:       string
 *   displayName?: string | null   // null clears the user override
 *   pictureUrl?:  string | null   // null clears the user override
 *
 * HTTPS-only validation on `pictureUrl` per
 * `.claude/rules/provider-url-sanitization.md` is enforced both client-side
 * (call sites validate via `useConfirmedSave`'s `validate` callback) AND
 * server-side. Returns the refreshed `ProfileDto`.
 */
export interface ProfileFieldPatch {
  email?: string;
  displayName?: string | null;
  pictureUrl?: string | null;
}

export async function patchProfile(patch: ProfileFieldPatch): Promise<ProfileDto> {
  return patchJson<ProfileDto>("/profile", patch, { contextScope: "session" });
}

/**
 * Patch a single settings row (locale, costBasisMethod, quotePollIntervalSeconds).
 * The legacy omnibus `PUT /settings/full` is retired in Phase 3d (S8 backend).
 */
export interface SettingsFieldPatch {
  locale?: UserSettings["locale"];
  quotePollIntervalSeconds?: number;
  costBasisMethod?: UserSettings["costBasisMethod"];
}

interface PatchSettingsOptions {
  keepalive?: boolean;
}

export async function patchSettings(
  patch: SettingsFieldPatch,
  options: PatchSettingsOptions = {},
): Promise<UserSettings> {
  return patchJson<UserSettings>("/settings", patch, { ...options, contextScope: "session" });
}
