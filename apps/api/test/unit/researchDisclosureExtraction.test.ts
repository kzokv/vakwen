import { describe, expect, it } from "vitest";
import { extractDisclosureContent, hasOnlyNonPaintingPdfOperations } from "../../src/services/research/providers/disclosureExtraction.js";

import { twoPagePdf } from "../fixtures/research/disclosurePdf.js";

describe("retained disclosure extraction", () => {
  it("PDF evidence: extract two pages → retain physical locations without verified claims", async () => {
    const result = await extractDisclosureContent(twoPagePdf(), "application/pdf", "issuer_1", "artifact_1");
    expect(result.totalPages).toBe(2);
    expect(result.blocks.map((block) => [block.page, block.text])).toEqual([[1, "Revenue 100 TWD"], [2, "Scheduled board meeting"]]);
    expect(result.blocks.every((block) => block.subject === "issuer_1" && block.extractionState === "retained_text")).toBe(true);
    expect(result).not.toHaveProperty("verifiedClaims");
    expect(result.extractionVersion).toContain("pdfjs");
  });

  it("HTML evidence: parse issuer table → preserve labels and cells without executable content", async () => {
    const bytes = new TextEncoder().encode('<html><head><meta charset="utf-8"><script>stealSecret()</script></head><body><h1>重大訊息</h1><p>會議 &amp; 公告</p><table id="financial"><tr><th>年度</th><th>營收（千元）</th></tr><tr><td>2026</td><td>1,234</td></tr></table><script>hidden()</script></body></html>');
    const result = await extractDisclosureContent(bytes, "text/html; charset=utf-8", "issuer_1", "artifact_1");
    expect(result.totalPages).toBe(1);
    expect(result.blocks.some((block) => block.table === "table:1" && block.text.includes("2026\t1,234"))).toBe(true);
    expect(result.blocks.map((block) => block.text).join("\n")).toContain("會議 & 公告");
    expect(JSON.stringify(result)).not.toMatch(/stealSecret|hidden\(\)/);
  });

  it("plain-text evidence: retain Unicode → preserve full text and deterministic block identifiers", async () => {
    const bytes = new TextEncoder().encode("公告😀\n100 TWD");
    const first = await extractDisclosureContent(bytes, "text/plain; charset=utf-8", "issuer_1", "artifact_1");
    expect(first.blocks[0]?.text).toBe("公告😀\n100 TWD");
    expect(await extractDisclosureContent(bytes, "text/plain", "issuer_1", "artifact_1")).toEqual(first);
  });

  it("unprocessable evidence: malformed PDF or unsupported type → fail without fabricated blocks", async () => {
    await expect(extractDisclosureContent(new TextEncoder().encode("not a PDF"), "application/pdf", "issuer_1", "artifact_1")).rejects.toThrow();
    await expect(extractDisclosureContent(new Uint8Array([1, 2]), "application/zip", "issuer_1", "artifact_1")).rejects.toThrow("unsupported");
  });
});

it("large HTML: Unicode paragraphs and oversized table row → bounded exact logical continuation", async () => {
  const paragraph = "😀".repeat(60_001);
  const cell = "證據".repeat(30_001) + " ".repeat(20_000) + "end";
  const extracted = await extractDisclosureContent(new TextEncoder().encode(`<html><body><p>${paragraph}</p><table><tr><td>${cell}</td></tr><tr><td>next row</td></tr></table></body></html>`), "text/html", "issuer", "large_html");
  expect(extracted.totalPages).toBeGreaterThan(3);
  expect(extracted.blocks.filter((block) => block.table === null).map((block) => block.text).join("")).toBe(paragraph);
  expect(extracted.blocks.filter((block) => block.table === "table:1").map((block) => block.text).join("")).toBe(cell + "\nnext row");
  for (let page = 1; page <= extracted.totalPages; page++) {
    expect(extracted.blocks.filter((block) => block.page === page).reduce((sum, block) => sum + Array.from(block.text).length, 0)).toBeLessThanOrEqual(50_000);
  }
  expect(extracted.extractionVersion).toBe("disclosure-html-cheerio/2.0.1");
});
it("PDF blank versus vector page: successful parsing → only proven blank gets explicit coverage", async () => {
  const text = "BT /F1 12 Tf 40 700 Td (Evidence) Tj ET";
  const blank = await extractDisclosureContent(twoPagePdf([text, "q Q"]), "application/pdf", "issuer", "blank");
  expect(blank.totalPages).toBe(2); expect(blank.confirmedEmptyPages).toEqual([2]);
  expect(blank.blocks.map((block) => block.page)).toEqual([1]);
  const vector = await extractDisclosureContent(twoPagePdf([text, "0 0 100 100 re f"]), "application/pdf", "issuer", "vector");
  expect(vector.totalPages).toBe(2); expect(vector.confirmedEmptyPages).toEqual([]);
  expect(vector.blocks.map((block) => block.page)).toEqual([1]);
});

it("physical PDF page: more than retrieval character budget → reject without relabeling pages", async () => {
  const pdf = (count: number) => twoPagePdf([`BT /F1 0.001 Tf 40 700 Td (${"a".repeat(count)}) Tj ET`, "q Q"]);
  await expect(extractDisclosureContent(pdf(50_001), "application/pdf", "issuer", "large")).rejects.toThrow("disclosure_extraction_physical_page_limit");
  const supported = await extractDisclosureContent(pdf(50_000), "application/pdf", "issuer", "boundary");
  expect(supported.blocks[0]?.text).toHaveLength(50_000);
  expect(supported.blocks[0]?.page).toBe(1);
  expect(supported.totalPages).toBe(2);
});


it.each([
  ["text setup", "BT /F1 12 Tf 1 Tc 2 Tw 95 Tz 14 TL 0 Tr 3 Ts 40 700 Td 0 -14 TD 1 0 0 1 0 0 Tm T* ET"],
  ["graphics setup", "q 2 w 1 J 2 j 10 M [3 2] 0 d /RelativeColorimetric ri 1 i 0.5 G 0.5 g 1 0 0 RG 0 1 0 rg 0 0 0 1 K 0 0 0 0 k Q"],
  ["marked content", "/Artifact BMC BT /F1 12 Tf ET EMC"],
] as const)("PDF %s without paint: actual operator list → confirmed blank physical page", async (_kind, stream) => {
  const result = await extractDisclosureContent(twoPagePdf(["BT /F1 12 Tf 40 700 Td (Evidence) Tj ET", stream]), "application/pdf", "issuer", "setup");
  expect(result.confirmedEmptyPages).toEqual([2]);
  expect(result.blocks.map((block) => block.page)).toEqual([1]);
  expect(result.extractionVersion).toMatch(/pdfjs-.*\/2\.0\.1$/);
  expect(result).not.toHaveProperty("verifiedClaims");
});

it("PDF operator safety: empty text extraction → painting/compositing and unknown operations never prove blank", async () => {
  const { OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  for (const operation of [OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText,
    OPS.stroke, OPS.fill, OPS.shadingFill, OPS.constructPath, OPS.rawFillPath, OPS.paintImageXObject,
    OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintFormXObjectBegin, OPS.endGroup, OPS.endAnnotation, 999_999]) {
    expect(hasOnlyNonPaintingPdfOperations([OPS.beginText, OPS.setFont, operation, OPS.endText], OPS)).toBe(false);
  }
});

const big5Html = (head = "", content = "adaba46ab054aea7") => Buffer.concat([
  Buffer.from(`<html><head>${head}</head><body><p>`), Buffer.from(content, "hex"), Buffer.from("</p></body></html>"),
]);
it.each([
  ["text/html; charset=big5", ""],
  ['text/html; CHARSET="Big5"', '<meta charset="utf-8">'],
  ["text/html", '<meta charset="big5">'],
  ["text/html", '<meta content="text/html; charset=big5" http-equiv="Content-Type">'],
] as const)("HTML %s %s: Big5 source → exact Chinese Unicode", async (mediaType, head) => {
  const result = await extractDisclosureContent(big5Html(head), mediaType, "issuer", "big5");
  expect(result.blocks.map((block) => block.text).join("")).toBe("重大訊息");
});
it.each(["text/html; charset=unknown-encoding", "text/html; charset=", "text/html; charset=big5; charset=utf-8"])("invalid charset %s → fail closed", async (mediaType) => {
  await expect(extractDisclosureContent(big5Html(), mediaType, "issuer", "bad")).rejects.toThrow();
});
it("text encoding: invalid bytes and unsupported meta → fail closed; BOM and UTF8 defaults preserved", async () => {
  for (const [bytes, media] of [[Buffer.from([0xa4]), "text/html; charset=big5"], [Buffer.from([0xff]), "text/html"], [big5Html('<meta charset="unknown-encoding">'), "text/html"]] as const) {
    await expect(extractDisclosureContent(bytes, media, "issuer", "bad")).rejects.toThrow();
  }
  const bytes = Buffer.from('\ufeff<html><head><meta charset="big5"></head><body>重大訊息</body></html>');
  expect((await extractDisclosureContent(bytes, "text/html; charset=big5", "issuer", "bom")).blocks[0]?.text).toBe("重大訊息");
  expect((await extractDisclosureContent(Buffer.from("重大訊息"), "text/plain", "issuer", "utf8")).blocks[0]?.text).toBe("重大訊息");
  expect((await extractDisclosureContent(Buffer.from('<html><head><!-- <meta charset="big5"> --><script>"<meta charset=big5>"</script></head><body>重大訊息</body></html>'), "text/html", "issuer", "utf8")).blocks[0]?.text).toBe("重大訊息");
});

it("HTML wide meta versus XHTML declaration: normalize HTML label and reject unsupported XML encoding", async () => {
  const html = Buffer.from('<html><head><meta charset="utf-16"></head><body>重大訊息</body></html>');
  expect((await extractDisclosureContent(html, "text/html", "issuer", "meta")).blocks[0]?.text).toBe("重大訊息");
  await expect(extractDisclosureContent(Buffer.from('<?xml version="1.0" encoding="big5"?><html><body>text</body></html>'), "application/xhtml+xml", "issuer", "xml")).rejects.toThrow("unsupported_xml_encoding");
});
