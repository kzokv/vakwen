import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { runOfficialDisclosureAcquisition } from "../../src/services/research/disclosureAcquisition.js";
import { createResearchDisclosureAcquisitionHandler, registerResearchDisclosureAcquisitionWorker, RESEARCH_DISCLOSURE_ACQUISITION_QUEUE, RESEARCH_DISCLOSURE_ACQUISITION_EXPIRE_SECONDS } from "../../src/services/research/registerDisclosureAcquisitionWorker.js";
vi.mock("../../src/services/research/disclosureAcquisition.js", () => ({ runOfficialDisclosureAcquisition: vi.fn().mockResolvedValue({ outcomes: [] }) }));
describe("disclosure worker registration", () => {
  it("scheduled and startup runs: shared singleton group → workload-sized expiry and one active key", async () => {
    const boss = { createQueue: vi.fn(), updateQueue: vi.fn(), work: vi.fn(), schedule: vi.fn(), send: vi.fn() };
    await registerResearchDisclosureAcquisitionWorker(boss as unknown as PgBoss, { persistence: new MemoryPersistence(), log: { info: vi.fn() } as unknown as FastifyBaseLogger });
    expect(RESEARCH_DISCLOSURE_ACQUISITION_EXPIRE_SECONDS).toBe(12 * 60 * 60);
    expect(boss.createQueue).toHaveBeenCalledWith(RESEARCH_DISCLOSURE_ACQUISITION_QUEUE, expect.objectContaining({ expireInSeconds: 43_200, policy: "singleton" }));
    expect(boss.updateQueue).toHaveBeenCalledWith(RESEARCH_DISCLOSURE_ACQUISITION_QUEUE, { expireInSeconds: 43_200 });
    expect(boss.schedule.mock.calls[0]?.[3]).toEqual({ singletonKey: RESEARCH_DISCLOSURE_ACQUISITION_QUEUE });
    expect(boss.send.mock.calls[0]?.[2]).toEqual(boss.schedule.mock.calls[0]?.[3]);
  });
  it("lease abort signal: handler → passes cancellation to acquisition", async () => {
    const controller = new AbortController();
    const handler = createResearchDisclosureAcquisitionHandler({ persistence: new MemoryPersistence(), log: { info: vi.fn() } as unknown as FastifyBaseLogger });
    await handler([{ id: "job1", signal: controller.signal } as JobWithMetadata<Record<string, never>>]);
    expect(runOfficialDisclosureAcquisition).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ signal: controller.signal, acquisitionRunId: "pg-boss:job1:disclosures" }));
  });
});
