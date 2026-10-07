import { load } from "cheerio";

/** Recognize MOPS gateway denial documents, independently of the declared MIME. */
export function isMopsAccessDenial(body: string): boolean {
  const trimmed = body.trimStart();
  // Publisher JSON and genuine PDF bytes may legitimately discuss access restrictions.
  if (/^(?:\{|\[|%PDF-)/.test(trimmed)) return false;
  if (trimmed.startsWith("<")) {
    const document = load(body);
    return hasDenialMessage(document("title").text()) || hasDenialMessage(document("body").text());
  }
  return hasDenialMessage(body);
}

function hasDenialMessage(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  return /this page can\s*not be accessed/i.test(text)
    || /^for security reasons[.,!:\s]*$/i.test(text)
    || (/安全性考量/.test(text) && /(?:無法|不能|不可).{0,12}(?:存取|訪問|瀏覽|呈現).{0,12}(?:網頁|網站|頁面)|(?:網頁|網站|頁面).{0,12}(?:無法|不能|不可).{0,12}(?:存取|訪問|瀏覽|呈現)/.test(text));
}
