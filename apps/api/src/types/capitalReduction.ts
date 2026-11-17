import type { AccountCapitalReductionDto, CapitalReductionAnnouncementDto, CapitalReductionPreviewDto } from "@vakwen/shared-types";
export interface CapitalReductionPreviewRecord {
  actorId: string;
  accessDigest: string;
  accountingDigest: string;
  preview: CapitalReductionPreviewDto;
  result?: AccountCapitalReductionDto;
}
export interface CapitalReductionAnnouncementPreviewRecord {
  actorId: string;
  accessDigest: string;
  accountingDigest: string;
  preview: import("@vakwen/shared-types").CapitalReductionAnnouncementPreviewDto;
  result?: CapitalReductionAnnouncementDto;
}
export interface CapitalReductionFacts {
  announcementPreviews?: CapitalReductionAnnouncementPreviewRecord[];
  announcementGenerations?: import("@vakwen/shared-types").CapitalReductionAnnouncementGenerationDto[];
  announcements: CapitalReductionAnnouncementDto[];
  actions: AccountCapitalReductionDto[];
  previews: CapitalReductionPreviewRecord[];
}
