import { createHash } from "node:crypto";
import { loadBuffer } from "cheerio";
import type { ResearchDisclosureArtifact } from "../disclosureContracts.js";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 1_000;
const MAX_CHARACTERS = 5_000_000;
type Block = ResearchDisclosureArtifact["blocks"][number];

/** Acquisition-only extraction: no URLs, network access, or verified-claim promotion. */
export async function extractDisclosureContent(
  bytes: Uint8Array,
  mediaType: string,
  subject: string,
  artifactId: string,
): Promise<{ blocks: Block[]; totalPages: number; extractionVersion: string }> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error("disclosure_extraction_size_limit");
  const type = mediaType.split(";", 1)[0]!.trim().toLowerCase();
  const blocks: Block[] = [];
  let characters = 0;
  function append(text: string, page: number, table: string | null = null) {
    if (!text.trim()) return;
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
    for (let page = 0; page < totalPages; page++) append(chars.slice(page * 10_000, (page + 1) * 10_000).join(""), page + 1);
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
    for (const part of content.split(new RegExp(`(\uE000${marker}\\d+\uE001)`))) {
      const table = new RegExp(`^\uE000${marker}(\\d+)\uE001$`).exec(part);
      if (table) append(tables[Number(table[1])]!, 1, `table:${Number(table[1]) + 1}`);
      else append(part.trim(), 1);
    }
    if (!blocks.length) throw new Error("disclosure_extraction_no_text");
    return { blocks, totalPages: 1, extractionVersion: "disclosure-html-cheerio/1.0.0" };
  }
  if (type !== "application/pdf") throw new Error("disclosure_extraction_unsupported_media_type");
  const { getDocument, version } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Only supplied bytes enter PDF.js; remote resource loading is disabled.
  // The caller retains the original bytes and their hash separately.
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true,
    disableFontFace: true, useWorkerFetch: false, disableAutoFetch: true, disableStream: true, stopAtErrors: true, verbosity: 0 });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PAGES) throw new Error("disclosure_extraction_page_limit");
    for (let page = 1; page <= document.numPages; page++) {
      const pdfPage = await document.getPage(page);
      const content = await pdfPage.getTextContent();
      const text = content.items.flatMap((item) => "str" in item ? [item.str + (item.hasEOL ? "\n" : " ")] : []).join("").trim();
      append(text, page);
      pdfPage.cleanup();
    }
    if (!blocks.length) throw new Error("disclosure_extraction_no_text");
    return { blocks, totalPages: document.numPages, extractionVersion: `disclosure-pdfjs-${version}/1.0.0` };
  } finally {
    await task.destroy();
  }
}
