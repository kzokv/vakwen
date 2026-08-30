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
    const handler = createResearchPriceAcquisitionHandler({
      persistence: {} as never,
      log: log as never,
    });

    await handler([{ id: "price-job-1" }] as never);

    expect(runOfficialIdentityAcquisition).toHaveBeenCalledWith(expect.anything(), {
      acquisitionRunId: "pg-boss:price-job-1:identity",
    });
    expect(runOfficialPriceAcquisition).toHaveBeenCalledWith(expect.anything(), {
      acquisitionRunId: "pg-boss:price-job-1:price",
    });
    expect(vi.mocked(runOfficialIdentityAcquisition).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(runOfficialPriceAcquisition).mock.invocationCallOrder[0]!);
    expect(log.info).toHaveBeenCalledWith(expect.any(Object), "research_identity_acquisition_before_price_completed");
    expect(log.info).toHaveBeenCalledWith(expect.any(Object), "research_price_acquisition_completed");
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
    expect(RESEARCH_PRICE_ACQUISITION_CRON).toBe("30 10 * * 1-5");
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
      {},
    );
    expect(boss.send).toHaveBeenCalledWith(
      RESEARCH_PRICE_ACQUISITION_QUEUE,
      {},
      { singletonKey: RESEARCH_PRICE_ACQUISITION_QUEUE },
    );
  });
});
