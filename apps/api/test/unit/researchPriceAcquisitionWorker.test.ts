import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/research/acquisition.js", () => ({
  runOfficialIdentityAcquisition: vi.fn(),
  runOfficialPriceAcquisition: vi.fn(),
}));

import {
  runOfficialIdentityAcquisition,
  runOfficialPriceAcquisition,
} from "../../src/services/research/acquisition.js";
import {
  createResearchPriceAcquisitionHandler,
  RESEARCH_PRICE_ACQUISITION_CRON,
  RESEARCH_PRICE_ACQUISITION_QUEUE,
  registerResearchPriceAcquisitionWorker,
} from "../../src/services/research/registerPriceAcquisitionWorker.js";

describe("registerResearchPriceAcquisitionWorker", () => {
  const activeCalendar = (calendarYear: number, exceptions: unknown[] = []) => ({
    marketCode: "TW",
    calendarYear,
    status: "confirmed",
    isActive: true,
    exceptions,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runOfficialIdentityAcquisition).mockResolvedValue({
      acquisitionRunId: "identity-run",
      sourceCount: 10,
      recordCount: 1,
      retrievedAt: "2026-08-28T10:30:00.000Z",
    });
    vi.mocked(runOfficialPriceAcquisition).mockResolvedValue({
      acquisitionRunId: "price-run",
      sourceCount: 5,
      recordCount: 1,
      retrievedAt: "2026-08-28T10:30:00.000Z",
    });
  });

  it("refreshes canonical identity before reading the same close snapshot", async () => {
    const log = { info: vi.fn() };
    const persistence = {
      getActiveMarketCalendarVersion: vi.fn(async (_marketCode, calendarYear) =>
        activeCalendar(calendarYear)),
    };
    const handler = createResearchPriceAcquisitionHandler({
      persistence: persistence as never,
      log: log as never,
      now: () => new Date("2026-08-28T10:30:00.000Z"),
    });

    await handler([{ id: "price-job-1" }] as never);

    expect(runOfficialIdentityAcquisition).toHaveBeenCalledWith(expect.anything(), {
      acquisitionRunId: "pg-boss:price-job-1:identity",
      retrievedAt: "2026-08-28T10:30:00.000Z",
    });
    expect(runOfficialPriceAcquisition).toHaveBeenCalledWith(expect.anything(), {
      acquisitionRunId: "pg-boss:price-job-1:price",
      retrievedAt: "2026-08-28T10:30:00.000Z",
    });
    expect(vi.mocked(runOfficialIdentityAcquisition).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(runOfficialPriceAcquisition).mock.invocationCallOrder[0]!);
    expect(log.info).toHaveBeenCalledWith(expect.any(Object), "research_identity_acquisition_before_price_completed");
    expect(log.info).toHaveBeenCalledWith(expect.any(Object), "research_price_acquisition_completed");
  });

  it("daily calendar gate: weekend-open session runs while a closed weekend skips acquisition", async () => {
    const weekendOpen = {
      date: "2026-08-29",
      status: "open",
      name: "Make-up trading session",
      evidence: "official calendar",
      overrideReason: "official calendar",
    };
    const persistence = {
      getActiveMarketCalendarVersion: vi.fn(async (_marketCode, calendarYear) =>
        activeCalendar(calendarYear, [weekendOpen])),
    };
    const log = { info: vi.fn() };
    const openHandler = createResearchPriceAcquisitionHandler({
      persistence: persistence as never,
      log: log as never,
      now: () => new Date("2026-08-29T10:30:00.000Z"),
    });

    await openHandler([{ id: "weekend-open", data: { trigger: "scheduled" } }] as never);
    expect(runOfficialPriceAcquisition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      retrievedAt: "2026-08-29T10:30:00.000Z",
    }));

    vi.clearAllMocks();
    persistence.getActiveMarketCalendarVersion.mockImplementation(async (_marketCode, calendarYear) =>
      activeCalendar(calendarYear));
    const closedHandler = createResearchPriceAcquisitionHandler({
      persistence: persistence as never,
      log: log as never,
      now: () => new Date("2026-08-30T10:30:00.000Z"),
    });
    await closedHandler([{ id: "weekend-closed", data: { trigger: "scheduled" } }] as never);

    expect(runOfficialIdentityAcquisition).not.toHaveBeenCalled();
    expect(runOfficialPriceAcquisition).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ localDate: "2026-08-30", status: "closed" }),
      "research_price_acquisition_skipped_closed_session",
    );

    vi.clearAllMocks();
    await closedHandler([{ id: "weekend-startup", data: { trigger: "startup" } }] as never);

    expect(runOfficialIdentityAcquisition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      acquisitionRunId: "pg-boss:weekend-startup:identity",
      retrievedAt: "2026-08-30T10:30:00.000Z",
    }));
    expect(runOfficialPriceAcquisition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      acquisitionRunId: "pg-boss:weekend-startup:price",
      retrievedAt: "2026-08-30T10:30:00.000Z",
    }));
  });

  it("registers the canonical research price worker on the Taiwan 18:30 close-acquisition schedule", async () => {
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      work: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
    };

    await registerResearchPriceAcquisitionWorker(boss as never, {
      persistence: {} as never,
      log: { info: vi.fn() } as never,
    });

    expect(RESEARCH_PRICE_ACQUISITION_QUEUE).toBe("research-price-acquisition");
    expect(RESEARCH_PRICE_ACQUISITION_CRON).toBe("30 10 * * *");
    expect(boss.createQueue).toHaveBeenCalledWith(
      RESEARCH_PRICE_ACQUISITION_QUEUE,
      expect.objectContaining({ policy: "singleton" }),
    );
    expect(boss.work).toHaveBeenCalledWith(
      RESEARCH_PRICE_ACQUISITION_QUEUE,
      expect.objectContaining({ batchSize: 1, includeMetadata: true }),
      expect.any(Function),
    );
    expect(boss.schedule).toHaveBeenCalledWith(
      RESEARCH_PRICE_ACQUISITION_QUEUE,
      RESEARCH_PRICE_ACQUISITION_CRON,
      { trigger: "scheduled" },
    );
    expect(boss.send).toHaveBeenCalledWith(
      RESEARCH_PRICE_ACQUISITION_QUEUE,
      { trigger: "startup" },
      { singletonKey: RESEARCH_PRICE_ACQUISITION_QUEUE },
    );
  });
});
