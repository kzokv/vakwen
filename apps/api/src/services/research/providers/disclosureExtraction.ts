import { createHash } from "node:crypto";
import { loadBuffer } from "cheerio";
import type { ResearchDisclosureArtifact } from "../disclosureContracts.js";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 1_000;
const MAX_CHARACTERS = 5_000_000;
type Block = ResearchDisclosureArtifact["blocks"][number];

/** Resolve only generic transport MIME; never guess arbitrary binary content is text. */
export function resolveDisclosureMediaType(bytes: Uint8Array, declared: string, attachmentType?: string): string {
  const type = declared.split(";", 1)[0]!.trim().toLowerCase();
  if (type && type !== "application/octet-stream" && type !== "binary/octet-stream") return type;
  if (Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from("%PDF-"))) return "application/pdf";
  if (attachmentType === "application/pdf") return "application/pdf"; // PDF.js validates the retained bytes.
  if (attachmentType === "text/plain" || attachmentType === "text/html" || attachmentType === "application/xhtml+xml") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    for (const character of text) {
      const code = character.charCodeAt(0);
      if (code < 32 && ![9, 10, 12, 13].includes(code)) throw new Error("disclosure_extraction_binary_text_mismatch");
    }
    if (attachmentType !== "text/plain" && !/^\s*(?:<\?xml\b[\s\S]*?\?>\s*)?(?:<!doctype\s+html\b|<(?:html|head|body|p|div|table|section|article|h[1-6])(?:\s|>))/i.test(text)) throw new Error("disclosure_extraction_html_signature_missing");
    return attachmentType;
  }
  return type || "application/octet-stream";
}

/** Acquisition-only extraction: no URLs, network access, or verified-claim promotion. */
export async function extractDisclosureContent(
  bytes: Uint8Array,
  mediaType: string,
  subject: string,
  artifactId: string,
): Promise<{ blocks: Block[]; totalPages: number; extractionVersion: string; confirmedEmptyPages?: number[] }> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error("disclosure_extraction_size_limit");
  const type = resolveDisclosureMediaType(bytes, mediaType);
  const blocks: Block[] = [];
  let characters = 0;
  function append(text: string, page: number, table: string | null = null, preserveWhitespace = false) {
    if (preserveWhitespace ? !text.length : !text.trim()) return;
    characters += Array.from(text).length;
    if (characters > MAX_CHARACTERS) throw new Error("disclosure_extraction_text_limit");
    const id = `block_${createHash("sha256").update(JSON.stringify([artifactId, page, table, blocks.length, text])).digest("hex").slice(0, 32)}`;
    blocks.push({ id, page, table, text, extractionState: "retained_text", subject, period: null, unit: null });
  }
  if (type === "text/plain") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Logical pages preserve every Unicode character without pretending to be
    // physical PDF locations. Their kind is clear from the artifact media type.
    const chars = Array.from(text);
    const totalPages = Math.max(1, Math.ceil(chars.length / 10_000));
    if (totalPages > MAX_PAGES) throw new Error("disclosure_extraction_page_limit");
    for (let page = 0; page < totalPages; page++) append(chars.slice(page * 10_000, (page + 1) * 10_000).join(""), page + 1, null, true);
    return { blocks, totalPages, extractionVersion: "disclosure-plain-text/1.0.0" };
  }
  if (type === "text/html" || type === "application/xhtml+xml") {
    const $ = loadBuffer(Buffer.from(bytes), { encoding: { defaultEncoding: "utf-8" } });
    $("script,style,noscript,template,iframe,object,embed,head").remove();
    $("br").replaceWith("\n");
    $("p,h1,h2,h3,h4,h5,h6,li,div,section,article").append("\n");
    // Replace tables with inert boundary markers to retain their original
    // position among surrounding paragraphs without duplicating table text.
    const tables: string[] = [];
    const marker = `DISCLOSURE_${createHash("sha256").update(bytes).digest("hex")}_TABLE_`;
    $("table").filter((_, element) => $(element).parents("table").length === 0).each((index, element) => {
      const rows = $(element).find("tr").toArray().map((row) =>
        $(row).children("th,td").toArray().map((cell) => $(cell).text().trim()).join("\t"),
      );
      tables.push(rows.join("\n"));
      $(element).replaceWith(`\uE000${marker}${index}\uE001`);
    });
    const content = $("body").text();
    let logicalPage = 1;
    let pageCharacters = 0;
    function appendLogical(text: string, table: string | null = null) {
      const size = Array.from(text).length;
      if (!text.length) return;
      if (size > 50_000 || Buffer.byteLength(JSON.stringify(text)) > 180 * 1024) throw new Error("disclosure_extraction_table_row_limit");
      if (pageCharacters && pageCharacters + size > 10_000) { logicalPage++; pageCharacters = 0; }
      if (logicalPage > MAX_PAGES) throw new Error("disclosure_extraction_page_limit");
      append(text, logicalPage, table, true);
      pageCharacters += size;
    }
    function appendTable(text: string, table: string) {
      // Keep an ordinary table together; larger tables continue at row boundaries
      // under the same stable table identifier. An oversized row continues as
      // exact logical text chunks; these labels do not claim physical page/row geometry.
      if (Array.from(text).length <= 10_000) { appendLogical(text, table); return; }
      const rows = text.split("\n");
      let chunk = "";
      for (const [index, row] of rows.entries()) {
        const rowText = row + (index < rows.length - 1 ? "\n" : "");
        const chars = Array.from(rowText);
        if (chars.length > 50_000 || Buffer.byteLength(JSON.stringify(rowText)) > 180 * 1024) {
          appendLogical(chunk, table); chunk = "";
          for (let offset = 0; offset < chars.length; offset += 10_000) appendLogical(chars.slice(offset, offset + 10_000).join(""), table);
        } else if (chunk && Array.from(chunk).length + chars.length > 10_000) {
          appendLogical(chunk, table); chunk = rowText;
        } else chunk += rowText;
      }
      appendLogical(chunk, table);
    }
    for (const part of content.split(new RegExp(`(\uE000${marker}\\d+\uE001)`))) {
      const table = new RegExp(`^\uE000${marker}(\\d+)\uE001$`).exec(part);
      if (table) appendTable(tables[Number(table[1])]!, `table:${Number(table[1]) + 1}`);
      else {
        const chars = Array.from(part.trim());
        for (let offset = 0; offset < chars.length; offset += 10_000) appendLogical(chars.slice(offset, offset + 10_000).join(""));
      }
    }
    if (!blocks.length) throw new Error("disclosure_extraction_no_text");
    return { blocks, totalPages: logicalPage, extractionVersion: "disclosure-html-cheerio/2.0.0" };
  }
  if (type !== "application/pdf") throw new Error("disclosure_extraction_unsupported_media_type");
  const { getDocument, version, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Only supplied bytes enter PDF.js; remote resource loading is disabled.
  // The caller retains the original bytes and their hash separately.
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true,
    disableFontFace: true, useWorkerFetch: false, disableAutoFetch: true, disableStream: true, stopAtErrors: true, verbosity: 0 });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PAGES) throw new Error("disclosure_extraction_page_limit");
    const confirmedEmptyPages: number[] = [];
    const nonPaintingOperations = new Set<number>([OPS.dependency, OPS.save, OPS.restore, OPS.transform]);
    for (let page = 1; page <= document.numPages; page++) {
      const pdfPage = await document.getPage(page);
      const content = await pdfPage.getTextContent();
      const text = content.items.flatMap((item) => "str" in item ? [item.str + (item.hasEOL ? "\n" : " ")] : []).join("").trim();
      if (Array.from(text).length > 50_000 || Buffer.byteLength(JSON.stringify(text)) > 180 * 1024) throw new Error("disclosure_extraction_physical_page_limit");
      append(text, page);
      if (!text) {
        const operators = await pdfPage.getOperatorList();
        if (operators.fnArray.every((operation) => nonPaintingOperations.has(operation))) confirmedEmptyPages.push(page);
      }
      pdfPage.cleanup();
    }
    if (!blocks.length && confirmedEmptyPages.length !== document.numPages) throw new Error("disclosure_extraction_no_text");
    return { blocks, totalPages: document.numPages, confirmedEmptyPages, extractionVersion: `disclosure-pdfjs-${version}/2.0.0` };
  } finally {
    await task.destroy();
  }
}
