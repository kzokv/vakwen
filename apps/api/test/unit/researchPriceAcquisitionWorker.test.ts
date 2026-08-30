import { describe, expect, it, vi } from "vitest";
import {
  RESEARCH_PRICE_ACQUISITION_CRON,
  RESEARCH_PRICE_ACQUISITION_QUEUE,
  registerResearchPriceAcquisitionWorker,
} from "../../src/services/research/registerPriceAcquisitionWorker.js";

describe("registerResearchPriceAcquisitionWorker", () => {
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
