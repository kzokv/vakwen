import { afterEach, expect, it, vi } from "vitest";
import { extractDisclosureContent } from "../../src/services/research/providers/disclosureExtraction.js";
const pdf = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: pdf.getDocument, version: "test", OPS: {} }));
afterEach(() => vi.clearAllMocks());
it.each(["loading", "page", "text", "operators"])("PDF %s: deadline expires → destroy task and preserve cancellation reason", async (stage) => {
  const controller = new AbortController();
  const reason = new Error("board deadline");
  const pending = () => {
    queueMicrotask(() => controller.abort(reason));
    return new Promise<never>(() => undefined);
  };
  const page = {
    getTextContent: vi.fn(() => stage === "text" ? pending() : Promise.resolve({ items: [] })),
    getOperatorList: vi.fn(pending), cleanup: vi.fn(),
  };
  const document = { numPages: 2, getPage: vi.fn(() => stage === "page" ? pending() : Promise.resolve(page)) };
  const destroy = vi.fn().mockResolvedValue(undefined);
  pdf.getDocument.mockImplementation(() => ({ promise: stage === "loading" ? pending() : Promise.resolve(document), destroy }));
  await expect(extractDisclosureContent(Buffer.from("%PDF-test"), "application/pdf", "issuer", "artifact", controller.signal)).rejects.toBe(reason);
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(document.getPage.mock.calls.length).toBeLessThanOrEqual(1);
});
it("cancelled before extraction: supplied reason → no PDF task created", async () => {
  const reason = new Error("worker stopped");
  await expect(extractDisclosureContent(Buffer.from("%PDF-test"), "application/pdf", "issuer", "artifact", AbortSignal.abort(reason))).rejects.toBe(reason);
  expect(pdf.getDocument).not.toHaveBeenCalled();
});
