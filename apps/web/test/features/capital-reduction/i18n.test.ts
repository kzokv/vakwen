import { describe, expect, it } from "vitest";
import { getCapitalReductionCopy } from "../../../features/capital-reduction/i18n";

describe("capital reduction translations", () => {
  it("English and Traditional Chinese: compare journey labels → preserve key parity and nonempty translated copy", () => {
    const en = getCapitalReductionCopy("en");
    const zh = getCapitalReductionCopy("zh-TW");
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(zh[key]).not.toBe("");
      expect(zh[key]).not.toBe(en[key]);
    }
  });
});
