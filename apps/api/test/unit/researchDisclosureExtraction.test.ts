import { describe, expect, it } from "vitest";
import { extractDisclosureContent } from "../../src/services/research/providers/disclosureExtraction.js";

// Synthetic PDF: two genuine page objects and streams, with a valid xref table.
function twoPagePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...["Revenue 100 TWD", "Scheduled board meeting"].map((text) => {
      const stream = `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
      return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  result += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(result));
}

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
