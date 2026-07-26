"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AccountLifecycleMutationResponseDto,
  AccountMutationResponseDto,
} from "@vakwen/shared-types";
import type { TransactionInput } from "../portfolio/types";
import { resolveErrorMessage } from "../../lib/utils";
import { resolveTransactionDraftAccount } from "../../features/dashboard/types";
import {
  fetchShellPortfolioConfig,
  type ShellPortfolioConfigDto,
} from "../../features/settings/services/shellPortfolioConfigService";

interface UseShellPortfolioConfigOptions {
  initialTransaction: TransactionInput;
  initialConfig?: ShellPortfolioConfigDto | null;
  fetchMode?: "eager" | "lazy";
}

interface UseShellPortfolioConfigResult extends ShellPortfolioConfigDto {
  isLoading: boolean;
  errorMessage: string;
  setErrorMessage: (message: string) => void;
  showIntegrityDialog: boolean;
  setShowIntegrityDialog: (open: boolean) => void;
  ensureLoaded: () => Promise<void>;
  refresh: () => Promise<ShellPortfolioConfigDto>;
  applyAccountMutation: (response: AccountMutationResponseDto) => void;
  applyAccountLifecycleMutation: (
    response: AccountLifecycleMutationResponseDto,
    operation: "soft_delete" | "restore" | "hard_purge",
  ) => void;
  synchronizeTransactionDraft: (previous: TransactionInput) => TransactionInput;
}

const EMPTY_CONFIG: ShellPortfolioConfigDto = {
  accounts: [],
  feeProfiles: [],
  feeProfileBindings: [],
  integrityIssue: null,
};

export function useShellPortfolioConfig({
  initialTransaction,
  initialConfig = null,
  fetchMode = "eager",
}: UseShellPortfolioConfigOptions): UseShellPortfolioConfigResult {
  const [config, setConfig] = useState<ShellPortfolioConfigDto>(initialConfig ?? EMPTY_CONFIG);
  const [isLoading, setIsLoading] = useState(initialConfig === null && fetchMode === "eager");
  const [errorMessage, setErrorMessage] = useState("");
  const [showIntegrityDialog, setShowIntegrityDialog] = useState(Boolean(initialConfig?.integrityIssue));
  const hasLoadedRef = useRef(initialConfig !== null);
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const fetchRequestIdRef = useRef(0);

  const fetchConfig = useCallback(async (): Promise<ShellPortfolioConfigDto> => {
    const requestId = ++fetchRequestIdRef.current;
    setIsLoading(true);
    try {
      const nextConfig = await fetchShellPortfolioConfig();
      if (requestId === fetchRequestIdRef.current) {
        setConfig(nextConfig);
        setShowIntegrityDialog(Boolean(nextConfig.integrityIssue));
        setErrorMessage("");
        hasLoadedRef.current = true;
      }
      return nextConfig;
    } catch (error) {
      if (requestId === fetchRequestIdRef.current) {
        setErrorMessage(resolveErrorMessage(error));
      }
      throw error;
    } finally {
      if (requestId === fetchRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const ensureLoaded = useCallback(async () => {
    if (hasLoadedRef.current) return;
    loadPromiseRef.current ??= fetchConfig()
      .then(() => undefined)
      .finally(() => {
        loadPromiseRef.current = null;
      });
    await loadPromiseRef.current;
  }, [fetchConfig]);

  const refresh = useCallback(async () => {
    return fetchConfig();
  }, [fetchConfig]);

  const applyAccountMutation = useCallback((response: AccountMutationResponseDto) => {
    fetchRequestIdRef.current += 1;
    setIsLoading(false);
    setConfig((current) => ({
      ...current,
      accounts: upsertById(current.accounts, response.account),
      capabilities: response.capabilities,
      feeProfiles: upsertById(current.feeProfiles, response.feeProfile),
    }));
  }, []);

  const applyAccountLifecycleMutation = useCallback((
    response: AccountLifecycleMutationResponseDto,
    operation: "soft_delete" | "restore" | "hard_purge",
  ) => {
    fetchRequestIdRef.current += 1;
    setIsLoading(false);
    setConfig((current) => {
      const accounts = operation === "restore"
        ? upsertById(current.accounts, response.account)
        : current.accounts.filter((account) => account.id !== response.accountId);
      if (operation !== "hard_purge") {
        const restoredFeeProfiles = operation === "restore" && response.feeProfiles
          ? [
              ...current.feeProfiles.filter(
                (profile) => profile.accountId !== response.accountId,
              ),
              ...response.feeProfiles,
            ]
          : current.feeProfiles;
        const restoredFeeProfileBindings = operation === "restore" && response.feeProfileBindings
          ? [
              ...current.feeProfileBindings.filter(
                (binding) => binding.accountId !== response.accountId,
              ),
              ...response.feeProfileBindings,
            ]
          : current.feeProfileBindings;
        return {
          ...current,
          accounts,
          capabilities: response.capabilities,
          feeProfiles: restoredFeeProfiles,
          feeProfileBindings: restoredFeeProfileBindings,
        };
      }
      const removedProfileIds = new Set(
        current.feeProfiles
          .filter((profile) => profile.accountId === response.accountId)
          .map((profile) => profile.id),
      );
      return {
        ...current,
        accounts,
        capabilities: response.capabilities,
        feeProfiles: current.feeProfiles.filter(
          (profile) => profile.accountId !== response.accountId,
        ),
        feeProfileBindings: current.feeProfileBindings.filter(
          (binding) => !removedProfileIds.has(binding.feeProfileId),
        ),
      };
    });
  }, []);

  useEffect(() => {
    if (initialConfig !== null) {
      setConfig(initialConfig);
      setShowIntegrityDialog(Boolean(initialConfig.integrityIssue));
      setIsLoading(false);
      hasLoadedRef.current = true;
      return;
    }

    if (fetchMode === "lazy") {
      setConfig(EMPTY_CONFIG);
      setShowIntegrityDialog(false);
      setIsLoading(false);
      hasLoadedRef.current = false;
      return;
    }

    let mounted = true;
    void ensureLoaded().catch(() => {
      if (!mounted) return;
    });
    return () => {
      mounted = false;
    };
  }, [ensureLoaded, fetchMode, initialConfig]);

  const synchronizeTransactionDraft = useCallback(
    (previous: TransactionInput) =>
      resolveTransactionDraftAccount(
        previous,
        config.accounts,
        config.feeProfiles,
        config.feeProfileBindings,
      ),
    [config.accounts, config.feeProfileBindings, config.feeProfiles],
  );

  const synchronizeInitialDraft = useCallback(
    () => resolveTransactionDraftAccount(initialTransaction, [], [], []),
    [initialTransaction],
  );

  return {
    ...config,
    isLoading,
    errorMessage,
    setErrorMessage,
    showIntegrityDialog,
    setShowIntegrityDialog,
    ensureLoaded,
    refresh,
    applyAccountMutation,
    applyAccountLifecycleMutation,
    synchronizeTransactionDraft: config.accounts.length > 0 ? synchronizeTransactionDraft : synchronizeInitialDraft,
  };
}

function upsertById<TItem extends { id: string }>(
  items: readonly TItem[],
  nextItem: TItem,
): TItem[] {
  const index = items.findIndex((item) => item.id === nextItem.id);
  if (index === -1) {
    return [...items, nextItem];
  }
  const next = [...items];
  next[index] = nextItem;
  return next;
}
