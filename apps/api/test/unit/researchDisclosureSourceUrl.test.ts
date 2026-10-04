import { describe, expect, it } from "vitest";
import { disclosureAttachmentSchema } from "../../src/services/research/disclosureContracts.js";
import { safeDisclosureUrl } from "../../src/services/research/providers/mopsAnnouncements.js";

const attachment = (sourceUrl: string) => ({ id: "attachment", artifactId: "artifact", title: "Official evidence", sourceUrl, mediaType: "application/pdf" });
describe("disclosure source URL credential boundary", () => {
  it.each([
    "access_token", "refresh_token", "API_KEY", "api-key", "ApiKey", "password", "passwd", "client_secret",
    "signature", "sig", "AWSAccessKeyId", "X-Amz-Credential", "X-Amz-Security-Token", "X-Amz-Signature",
    "X-Goog-Credential", "X-Goog-Signature", "GoogleAccessId", "Key-Pair-Id", "SharedAccessSignature", "sas_token", "SharedAccessKey", "AWSSecretAccessKey", "AWSSessionToken", "X-Goog-Security-Token",
    "%61ccess%5Ftoken", "%41PI%5FKEY", "%73ig", "%58%2DAmz%2DCredential", "%2561ccess_token",
  ])("credential parameter %s → rejected by stored contract and acquisition guard", (name) => {
    const url = `https://mops.twse.com.tw/mops/api/t05st01_detail?companyId=2330&${name}=sensitive`;
    expect(disclosureAttachmentSchema.safeParse(attachment(url)).success).toBe(false);
    expect(safeDisclosureUrl(url)).toBe(false);
  });
  it.each([
    "https://mops.twse.com.tw/mops/api/t05st01_detail?marketKind=sii&companyId=2330&serialNumber=1&enterDate=1151004",
    "https://mopsov.twse.com.tw/server-java/t56ags1?step=1&co_id=2330&year=115&season=2&filename=report.pdf",
    "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O?response=json",
    "https://mops.twse.com.tw/report.pdf?%63ompanyId=2330&keyword=capital&authoredBy=MOPS",
    "https://mops.twse.com.tw/#/web/t05st01?companyId=2330",
  ])("ordinary official routing URL → retained: %s", (url) => {
    expect(disclosureAttachmentSchema.safeParse(attachment(url)).success).toBe(true);
    expect(safeDisclosureUrl(url)).toBe(true);
  });
  it.each(["#access_token=sensitive", "#/route?api_key=sensitive"])("credential-bearing fragment %s → rejected", (fragment) => {
    const url = `https://mops.twse.com.tw/${fragment}`;
    expect(disclosureAttachmentSchema.safeParse(attachment(url)).success).toBe(false);
    expect(safeDisclosureUrl(url)).toBe(false);
  });
  it("URL authority and provider host → independent restrictions remain", () => {
    for (const url of ["http://mops.twse.com.tw/report.pdf", "https://user:secret@mops.twse.com.tw/report.pdf", "not-a-url"]) {
      expect(disclosureAttachmentSchema.safeParse(attachment(url)).success).toBe(false);
      expect(safeDisclosureUrl(url)).toBe(false);
    }
    expect(safeDisclosureUrl("https://unrelated.example/report.pdf")).toBe(false);
  });
});
