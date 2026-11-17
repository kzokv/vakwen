import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapitalReductionPreviewDto, CapitalReductionAnnouncementInputDto, CapitalReductionAnnouncementPreviewDto } from "@vakwen/shared-types";
vi.mock("../../../lib/api", () => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock("../../../lib/routeDtoCache", () => ({ clearPortfolioContextRouteCaches: vi.fn() }));
import { getJson, postJson } from "../../../lib/api";
import { clearPortfolioContextRouteCaches } from "../../../lib/routeDtoCache";
import { confirmCapitalReduction, fetchCapitalReductions, retryCapitalReductionGeneration, previewCapitalReductionAnnouncement, confirmCapitalReductionAnnouncement, retryCapitalReductionAnnouncementGeneration } from "../../../features/capital-reduction/service";

describe("capital reduction service", () => {
  afterEach(() => vi.clearAllMocks());
  it("account holding: load history → send singular encoded scope", async () => {
    vi.mocked(getJson).mockResolvedValue({ actions: [], announcements: [] });
    await fetchCapitalReductions({ accountId: "synthetic/account", ticker: "SYN TH" });
    expect(getJson).toHaveBeenCalledWith("/portfolio/capital-reductions?accountId=synthetic%2Faccount&ticker=SYN+TH", { signal: undefined });
  });
  it("confirmation: submit reviewed server binding → retain every confirmation field", async () => {
    vi.mocked(postJson).mockResolvedValue({ id: "synthetic-action" });
    await confirmCapitalReduction({ previewId: "preview", fingerprint: "binding", confirmationDigest: "digest", confirmationSummary: "reviewed" } as CapitalReductionPreviewDto);
    expect(postJson).toHaveBeenCalledWith("/portfolio/capital-reductions/confirm", { previewId: "preview", fingerprint: "binding", confirmationDigest: "digest", confirmationSummary: "reviewed", confirmed: true });
    expect(clearPortfolioContextRouteCaches).toHaveBeenCalledOnce();
  });
  it("snapshot failure: request retry → scope action and invalidate cached reports", async () => {
    vi.mocked(postJson).mockResolvedValue({ id: "synthetic-action" });
    await retryCapitalReductionGeneration("synthetic/action");
    expect(postJson).toHaveBeenCalledWith("/portfolio/capital-reductions/synthetic%2Faction/retry-generation", {});
    expect(clearPortfolioContextRouteCaches).toHaveBeenCalledOnce();
  });
  it("announcement preparation: preview only published terms → use source registration endpoint without financial facts", async () => {
    const input: CapitalReductionAnnouncementInputDto = { accountId: "synthetic-account", reason: "register public terms", announcement: { eventId: "synthetic-event", version: 1, ticker: "SYNTH", marketCode: "TW", venue: "TWSE", instrumentType: "STOCK", currency: "TWD", officialReference: "synthetic-future-announcement", sourceUrl: "https://example.com/source", publishedDate: "2026-01-01", reductionDate: "2026-02-01", suspensionStartDate: "2026-02-02", suspensionEndDate: "2026-02-03", exchangeRecordDate: "2026-02-04", conversionDate: "2026-02-05", conversionTimestamp: "2026-02-05T09:00:00+08:00", scheduledPaymentDate: "2026-02-06", ratioNumerator: "542.0491512", ratioDenominator: "1000", repaymentPerOldShare: "4.579", payoutRounding: "FLOOR" } };
    vi.mocked(postJson).mockResolvedValue({ previewId: "source-preview", input });
    await previewCapitalReductionAnnouncement(input);
    expect(postJson).toHaveBeenCalledExactlyOnceWith("/portfolio/capital-reductions/announcements/preview", input);
    expect(clearPortfolioContextRouteCaches).not.toHaveBeenCalled();
    expect(input).not.toHaveProperty("confirmedWholeQuantity");
    expect(input).not.toHaveProperty("repaymentReceipts");
  });
  it("source registration confirmation: bind reviewed terms → refresh holdings without posting conversion", async () => {
    vi.mocked(postJson).mockResolvedValue({ eventId: "synthetic-event", version: 1 });
    await confirmCapitalReductionAnnouncement({ previewId: "source-preview", fingerprint: "source-binding", confirmationDigest: "source-digest", confirmationSummary: "reviewed source" } as CapitalReductionAnnouncementPreviewDto);
    expect(postJson).toHaveBeenCalledExactlyOnceWith("/portfolio/capital-reductions/announcements/confirm", { previewId: "source-preview", fingerprint: "source-binding", confirmationDigest: "source-digest", confirmationSummary: "reviewed source", confirmed: true });
    expect(clearPortfolioContextRouteCaches).toHaveBeenCalledOnce();
  });
  it("registered source history: retry regeneration → preserve selected account and immutable version scope", async () => {
    vi.mocked(postJson).mockResolvedValue({ accountId: "synthetic-account", eventId: "synthetic-event", version: 2 });
    await retryCapitalReductionAnnouncementGeneration({ accountId: "synthetic-account", eventId: "synthetic-event", version: 2 });
    expect(postJson).toHaveBeenCalledExactlyOnceWith("/portfolio/capital-reductions/announcements/retry-generation", { accountId: "synthetic-account", eventId: "synthetic-event", version: 2 });
    expect(clearPortfolioContextRouteCaches).toHaveBeenCalledOnce();
  });
  it("rejected confirmation: preserve cache → retain existing visible source state", async () => {
    vi.mocked(postJson).mockRejectedValue(new Error("stale preview"));
    await expect(confirmCapitalReduction({ previewId: "preview" } as CapitalReductionPreviewDto)).rejects.toThrow("stale preview");
    expect(clearPortfolioContextRouteCaches).not.toHaveBeenCalled();
  });
});
