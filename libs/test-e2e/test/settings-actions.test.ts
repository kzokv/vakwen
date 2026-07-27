import { describe, expect, it } from "vitest";
import { buildAccountListIdentityHeaders } from "../src/assistants/settings/SettingsActions.js";

describe("SettingsActions account lookup identity", () => {
  it("preserves both the browser session identity and shared owner context", () => {
    expect(buildAccountListIdentityHeaders([
      { name: "tw_e2e_user", value: "viewer-1" },
      { name: "tw_context_user_id", value: "owner-1" },
    ])).toEqual({
      "x-user-id": "viewer-1",
      "x-context-user-id": "owner-1",
    });
  });

  it("uses only the session identity outside shared context", () => {
    expect(buildAccountListIdentityHeaders([
      { name: "tw_e2e_user", value: "owner-1" },
    ])).toEqual({
      "x-user-id": "owner-1",
    });
  });
});
