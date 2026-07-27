import type {
  AccountMutationResponseDto,
  AccountLifecycleMutationResponseDto,
  AccountDefaultCurrency,
  AccountDto,
  FeeProfileDto,
  PortfolioCapabilitiesDto,
  PortfolioSelectionNormalizationResult,
} from "@vakwen/shared-types";
import type { EventBus } from "../events/types.js";
import type {
  AccountLifecyclePersistenceResult,
  AccountMutationPersistenceResult,
  Persistence,
} from "../persistence/types.js";
import type { FastifyBaseLogger } from "fastify";
import { resolveReportingCurrency } from "./userPreferences.js";

type AccountEventDeps = {
  persistence: Pick<Persistence, "getUserPreferences" | "listSharesForOwner">;
  eventBus: Pick<EventBus, "publishEvent">;
  log?: Pick<FastifyBaseLogger, "warn">;
};

type MutationEventName = "account_created" | "account_updated";
type LifecycleEventName = "account_soft_deleted" | "account_restored" | "account_hard_purged";

type MutationEventPayload = {
  type: MutationEventName;
  accountId: string;
  account: AccountDto;
  feeProfile: FeeProfileDto;
  capabilities: PortfolioCapabilitiesDto;
  reportingCurrency: AccountMutationResponseDto["reportingCurrency"];
  changedFields?: string[];
};

type LifecycleEventPayload =
  | {
      type: "account_soft_deleted";
      accountId: string;
      deletedAt: string;
      account: AccountDto;
      capabilities: PortfolioCapabilitiesDto;
      reportingCurrency: AccountLifecycleMutationResponseDto["reportingCurrency"];
    }
  | {
      type: "account_restored";
      accountId: string;
      finalName: string;
      account: AccountDto;
      capabilities: PortfolioCapabilitiesDto;
      reportingCurrency: AccountLifecycleMutationResponseDto["reportingCurrency"];
    }
  | {
      type: "account_hard_purged";
      accountId: string;
      deletedAt: string | null;
      account: AccountDto;
      capabilities: PortfolioCapabilitiesDto;
      reportingCurrency: AccountLifecycleMutationResponseDto["reportingCurrency"];
    };

export function normalizeRequestedReportingCurrency(
  configuredCurrencies: readonly AccountDefaultCurrency[],
  requested: AccountDefaultCurrency | null,
): PortfolioSelectionNormalizationResult<AccountDefaultCurrency> {
  if (configuredCurrencies.length === 0) {
    return { requested, effective: null, reason: "no_configured_currencies" };
  }
  if (requested === null) {
    return { requested: null, effective: configuredCurrencies[0]!, reason: null };
  }
  if (configuredCurrencies.includes(requested)) {
    return { requested, effective: requested, reason: null };
  }
  return {
    requested,
    effective: configuredCurrencies[0]!,
    reason: "unconfigured_currency",
  };
}

async function loadActiveTargets(
  persistence: Pick<Persistence, "listSharesForOwner">,
  ownerUserId: string,
): Promise<string[]> {
  const shares = await persistence.listSharesForOwner(ownerUserId);
  return [...new Set<string>([ownerUserId, ...shares.active.map((share) => share.granteeUserId)])];
}

export async function buildAccountMutationReportingCurrencyForContext(
  persistence: Pick<Persistence, "getUserPreferences">,
  payload: Pick<AccountMutationPersistenceResult, "capabilities">,
  sessionUserId: string,
): Promise<AccountMutationResponseDto["reportingCurrency"]> {
  const prefs = await persistence.getUserPreferences(sessionUserId);
  return normalizeRequestedReportingCurrency(
    payload.capabilities.configuredCurrencies,
    resolveReportingCurrency(prefs),
  );
}

export async function buildLifecycleReportingCurrencyForContext(
  persistence: Pick<Persistence, "getUserPreferences">,
  payload: AccountLifecyclePersistenceResult,
  sessionUserId: string,
  useAuthoritativeOwnerPreference: boolean,
): Promise<AccountLifecycleMutationResponseDto["reportingCurrency"]> {
  if (useAuthoritativeOwnerPreference) {
    return payload.reportingCurrency;
  }
  const prefs = await persistence.getUserPreferences(sessionUserId);
  return normalizeRequestedReportingCurrency(
    payload.capabilities.configuredCurrencies,
    resolveReportingCurrency(prefs),
  );
}

export async function publishAccountMutationEventToOwnerAndActiveGrantees(
  deps: AccountEventDeps,
  ownerUserId: string,
  eventName: MutationEventName,
  payload: AccountMutationPersistenceResult,
): Promise<void> {
  try {
    const targets = await loadActiveTargets(deps.persistence, ownerUserId);
    await Promise.all(
      targets.map(async (targetUserId) => {
        const eventPayload: MutationEventPayload = {
          type: eventName,
          accountId: payload.account.id,
          account: payload.account,
          feeProfile: payload.feeProfile,
          capabilities: payload.capabilities,
          reportingCurrency: await buildAccountMutationReportingCurrencyForContext(
            deps.persistence,
            payload,
            targetUserId,
          ),
          ...(payload.changedFields && payload.changedFields.length > 0
            ? { changedFields: payload.changedFields }
            : {}),
        };
        await deps.eventBus.publishEvent(targetUserId, eventName, eventPayload);
      }),
    );
  } catch (error) {
    deps.log?.warn(
      { err: error, ownerUserId, accountId: payload.account.id, eventName },
      "account_mutation_event_fanout_failed",
    );
  }
}

export async function publishLifecycleEventToOwnerAndActiveGrantees(
  deps: AccountEventDeps,
  ownerUserId: string,
  eventName: LifecycleEventName,
  payload: AccountLifecyclePersistenceResult,
): Promise<void> {
  try {
    const targets = await loadActiveTargets(deps.persistence, ownerUserId);
    await Promise.all(
      targets.map(async (targetUserId) => {
        const reportingCurrency = await buildLifecycleReportingCurrencyForContext(
          deps.persistence,
          payload,
          targetUserId,
          targetUserId === ownerUserId,
        );
        let eventPayload: LifecycleEventPayload;
        if (eventName === "account_soft_deleted") {
          eventPayload = {
            type: eventName,
            accountId: payload.account.id,
            deletedAt: payload.deletedAt!,
            account: payload.account,
            capabilities: payload.capabilities,
            reportingCurrency,
          };
        } else if (eventName === "account_restored") {
          eventPayload = {
            type: eventName,
            accountId: payload.account.id,
            finalName: payload.finalName!,
            account: payload.account,
            capabilities: payload.capabilities,
            reportingCurrency,
          };
        } else {
          eventPayload = {
            type: eventName,
            accountId: payload.account.id,
            deletedAt: payload.deletedAt,
            account: payload.account,
            capabilities: payload.capabilities,
            reportingCurrency,
          };
        }
        await deps.eventBus.publishEvent(targetUserId, eventName, eventPayload);
      }),
    );
  } catch (error) {
    deps.log?.warn(
      { err: error, ownerUserId, accountId: payload.account.id, eventName },
      "account_lifecycle_event_fanout_failed",
    );
  }
}
