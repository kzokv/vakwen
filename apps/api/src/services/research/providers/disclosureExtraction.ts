import { createHash } from "node:crypto";
import { load } from "cheerio";
import { isMopsAccessDenial } from "./mopsAccessDenial.js";
import type { ResearchDisclosureArtifact } from "../disclosureContracts.js";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 1_000;
const MAX_CHARACTERS = 5_000_000;
type Block = ResearchDisclosureArtifact["blocks"][number];

/** Decode retained text strictly; never silently replace malformed source bytes. */
export function decodeDisclosureText(bytes: Uint8Array, mediaType: string): string {
  const parameters = mediaType.split(";").slice(1);
  const charsets = parameters.filter((part) => /^\s*charset\b/i.test(part));
  if (charsets.length > 1) throw new Error("disclosure_extraction_invalid_charset");
  const match = charsets[0]?.match(/^\s*charset\s*=\s*(?:"([A-Za-z0-9._:-]+)"|([A-Za-z0-9._:-]+))\s*$/i);
  if (charsets.length && !match) throw new Error("disclosure_extraction_invalid_charset");
  let encoding = match?.[1] ?? match?.[2];
  // Validate declarations even when a BOM would otherwise override them.
  if (encoding) new TextDecoder(encoding, { fatal: true });
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = "utf-8";
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  if (!encoding && /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(mediaType)) {
    // Attribute syntax is ASCII in HTML-compatible encodings; parse only the
    // bounded prescan, then decode the original bytes with the selected label.
    const prescan = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
    const xmlEncoding = /^\s*<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(prescan)?.[1];
    if (/^application\/xhtml\+xml(?:;|$)/i.test(mediaType) && xmlEncoding && new TextDecoder(xmlEncoding).encoding !== "utf-8") throw new Error("disclosure_extraction_unsupported_xml_encoding");
    const head = load(prescan);
    for (const meta of head("meta").toArray()) {
      const element = head(meta);
      const label = element.attr("charset") ?? (element.attr("http-equiv")?.toLowerCase() === "content-type"
        ? element.attr("content")?.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] : undefined);
      if (label !== undefined) { encoding = label.trim(); if (!encoding) throw new Error("disclosure_extraction_invalid_charset");
        // HTML prescan treats UTF-16 labels as UTF-8 without a BOM.
        if (["utf-16le", "utf-16be"].includes(new TextDecoder(encoding).encoding)) encoding = "utf-8";
        break; }
    }
  }
  return new TextDecoder(encoding ?? "utf-8", { fatal: true }).decode(bytes);
}

/** Resolve only generic transport MIME; never guess arbitrary binary content is text. */
export function resolveDisclosureMediaType(bytes: Uint8Array, declared: string, attachmentType?: string): string {
  const type = declared.split(";", 1)[0]!.trim().toLowerCase();
  if (type && type !== "application/octet-stream" && type !== "binary/octet-stream") return type;
  if (Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from("%PDF-"))) return "application/pdf";
  if (attachmentType === "application/pdf") return "application/pdf"; // PDF.js validates the retained bytes.
  if (attachmentType === "text/plain" || attachmentType === "text/html" || attachmentType === "application/xhtml+xml") {
    const text = decodeDisclosureText(bytes, `${attachmentType}${declared.includes(";") ? declared.slice(declared.indexOf(";")) : ""}`);
    for (const character of text) {
      const code = character.charCodeAt(0);
      if (code < 32 && ![9, 10, 12, 13].includes(code)) throw new Error("disclosure_extraction_binary_text_mismatch");
    }
    if (attachmentType !== "text/plain" && !/^\s*(?:<\?xml\b[\s\S]*?\?>\s*)?(?:<!doctype\s+html\b|<(?:html|head|body|p|div|table|section|article|h[1-6])(?:\s|>))/i.test(text)) throw new Error("disclosure_extraction_html_signature_missing");
    return attachmentType;
  }
  return type || "application/octet-stream";
}

/** Known state/path setup only; unknown, text-showing, and painting operations are never blank proof. */
export function hasOnlyNonPaintingPdfOperations(operations: readonly number[], ops: typeof import("pdfjs-dist/legacy/build/pdf.mjs").OPS): boolean {
  // Checked against PDF.js CanvasGraphics: constructPath dispatches a paint operation,
  // and forms/groups/annotations may composite content, so none is included here.
  const nonPainting = new Set<number>([
    ops.dependency, ops.save, ops.restore, ops.transform,
    ops.setLineWidth, ops.setLineCap, ops.setLineJoin, ops.setMiterLimit, ops.setDash, ops.setRenderingIntent, ops.setFlatness, ops.setGState,
    ops.moveTo, ops.lineTo, ops.curveTo, ops.curveTo2, ops.curveTo3, ops.closePath, ops.rectangle, ops.endPath, ops.clip, ops.eoClip,
    ops.beginText, ops.endText, ops.setCharSpacing, ops.setWordSpacing, ops.setHScale, ops.setLeading, ops.setFont,
    ops.setTextRenderingMode, ops.setTextRise, ops.moveText, ops.setLeadingMoveText, ops.setTextMatrix, ops.nextLine,
    ops.setCharWidth, ops.setCharWidthAndBounds,
    ops.setStrokeColorSpace, ops.setFillColorSpace, ops.setStrokeColor, ops.setStrokeColorN, ops.setFillColor, ops.setFillColorN,
    ops.setStrokeGray, ops.setFillGray, ops.setStrokeRGBColor, ops.setFillRGBColor, ops.setStrokeCMYKColor, ops.setFillCMYKColor,
    ops.setStrokeTransparent, ops.setFillTransparent,
    ops.markPoint, ops.markPointProps, ops.beginMarkedContent, ops.beginMarkedContentProps, ops.endMarkedContent, ops.beginCompat, ops.endCompat,
  ]);
  return operations.every((operation) => nonPainting.has(operation));
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
    const text = decodeDisclosureText(bytes, mediaType);
    if (isMopsAccessDenial(text)) throw new Error("disclosure_access_restricted");
    // Logical pages preserve every Unicode character without pretending to be
    // physical PDF locations. Their kind is clear from the artifact media type.
    const chars = Array.from(text);
    const totalPages = Math.max(1, Math.ceil(chars.length / 10_000));
    if (totalPages > MAX_PAGES) throw new Error("disclosure_extraction_page_limit");
    for (let page = 0; page < totalPages; page++) append(chars.slice(page * 10_000, (page + 1) * 10_000).join(""), page + 1, null, true);
    return { blocks, totalPages, extractionVersion: "disclosure-plain-text/1.0.1" };
  }
  if (type === "text/html" || type === "application/xhtml+xml") {
    const text = decodeDisclosureText(bytes, mediaType);
    if (isMopsAccessDenial(text)) throw new Error("disclosure_access_restricted");
    const $ = load(text);
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
    return { blocks, totalPages: logicalPage, extractionVersion: "disclosure-html-cheerio/2.0.1" };
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
    for (let page = 1; page <= document.numPages; page++) {
      const pdfPage = await document.getPage(page);
      const content = await pdfPage.getTextContent();
      const text = content.items.flatMap((item) => "str" in item ? [item.str + (item.hasEOL ? "\n" : " ")] : []).join("").trim();
      if (Array.from(text).length > 50_000 || Buffer.byteLength(JSON.stringify(text)) > 180 * 1024) throw new Error("disclosure_extraction_physical_page_limit");
      append(text, page);
      if (!text) {
        const operators = await pdfPage.getOperatorList();
        if (hasOnlyNonPaintingPdfOperations(operators.fnArray, OPS)) confirmedEmptyPages.push(page);
      }
      pdfPage.cleanup();
    }
    if (!blocks.length && confirmedEmptyPages.length !== document.numPages) throw new Error("disclosure_extraction_no_text");
    return { blocks, totalPages: document.numPages, confirmedEmptyPages, extractionVersion: `disclosure-pdfjs-${version}/2.0.1` };
  } finally {
    await task.destroy();
  }
}
