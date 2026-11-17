"use client";

import type { AccountCapitalReductionDto, CapitalReductionAnnouncementDto, CapitalReductionAnnouncementGenerationDto, CapitalReductionAnnouncementInputDto, CapitalReductionAnnouncementPreviewDto, CapitalReductionConfirmDto, CapitalReductionInputDto, CapitalReductionPreviewDto } from "@vakwen/shared-types";
import { getJson, postJson } from "../../lib/api";
import { clearPortfolioContextRouteCaches } from "../../lib/routeDtoCache";

export const CAPITAL_REDUCTION_CHANGED_EVENT = "vakwen:capital-reduction-changed";
export interface CapitalReductionScope { accountId: string; ticker: string }
export interface CapitalReductionList { actions: AccountCapitalReductionDto[]; announcements: CapitalReductionAnnouncementDto[]; announcementGenerations?: CapitalReductionAnnouncementGenerationDto[] }

export function fetchCapitalReductions(scope: CapitalReductionScope, signal?: AbortSignal): Promise<CapitalReductionList> {
  const query = new URLSearchParams({ accountId: scope.accountId, ticker: scope.ticker });
  return getJson<CapitalReductionList>(`/portfolio/capital-reductions?${query}`, { signal });
}
export function previewCapitalReduction(input: CapitalReductionInputDto): Promise<CapitalReductionPreviewDto> {
  return postJson<CapitalReductionPreviewDto>("/portfolio/capital-reductions/preview", input);
}
function invalidate(): void {
  clearPortfolioContextRouteCaches();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CAPITAL_REDUCTION_CHANGED_EVENT));
}
export async function confirmCapitalReduction(preview: CapitalReductionPreviewDto): Promise<AccountCapitalReductionDto> {
  const request: CapitalReductionConfirmDto = {
    previewId: preview.previewId, fingerprint: preview.fingerprint, confirmationDigest: preview.confirmationDigest,
    confirmationSummary: preview.confirmationSummary, confirmed: true,
  };
  const result = await postJson<AccountCapitalReductionDto>("/portfolio/capital-reductions/confirm", request);
  invalidate();
  return result;
}
export async function retryCapitalReductionGeneration(actionId: string): Promise<AccountCapitalReductionDto> {
  const result = await postJson<AccountCapitalReductionDto>(`/portfolio/capital-reductions/${encodeURIComponent(actionId)}/retry-generation`, {});
  invalidate();
  return result;
}

export function previewCapitalReductionAnnouncement(input: CapitalReductionAnnouncementInputDto): Promise<CapitalReductionAnnouncementPreviewDto> {
  return postJson<CapitalReductionAnnouncementPreviewDto>("/portfolio/capital-reductions/announcements/preview", input);
}

export async function confirmCapitalReductionAnnouncement(preview: CapitalReductionAnnouncementPreviewDto): Promise<CapitalReductionAnnouncementDto> {
  const request: CapitalReductionConfirmDto = {
    previewId: preview.previewId, fingerprint: preview.fingerprint, confirmationDigest: preview.confirmationDigest,
    confirmationSummary: preview.confirmationSummary, confirmed: true,
  };
  const result = await postJson<CapitalReductionAnnouncementDto>("/portfolio/capital-reductions/announcements/confirm", request);
  invalidate();
  return result;
}

export async function retryCapitalReductionAnnouncementGeneration(scope: Pick<CapitalReductionAnnouncementGenerationDto, "accountId" | "eventId" | "version">): Promise<CapitalReductionAnnouncementGenerationDto> {
  const result = await postJson<CapitalReductionAnnouncementGenerationDto>("/portfolio/capital-reductions/announcements/retry-generation", scope);
  invalidate();
  return result;
}
