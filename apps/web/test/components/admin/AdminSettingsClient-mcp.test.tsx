import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AiConnectorPolicySettingsDto } from "@vakwen/shared-types";

const mockGetJson = vi.fn();
const mockPatchJson = vi.fn();
const mockPostJson = vi.fn();

vi.mock("../../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  getJson: (...args: unknown[]) => mockGetJson(...args),
  patchJson: (...args: unknown[]) => mockPatchJson(...args),
  postJson: (...args: unknown[]) => mockPostJson(...args),
}));

let mockParams = new URLSearchParams({ tab: "mcp" });

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/admin/settings",
  useSearchParams: () => mockParams,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import { AdminSettingsClient } from "../../../components/admin/AdminSettingsClient";
import { buildAppConfigDto } from "../../fixtures/appConfigDto";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  }
});

function buildPolicy(overrides: Partial<AiConnectorPolicySettingsDto> = {}): AiConnectorPolicySettingsDto {
  return {
    enabled: true,
    maxActiveConnectionsPerUser: 3,
    allowedProviders: { chatgpt: true, self_hosted: true },
    allowedClientKinds: {
      chatgpt_app: true,
      claude_ai_connector: true,
      claude_code: true,
      codex_cli: true,
      gemini_cli: true,
      copilot_mcp: true,
      generic_mcp: true,
    },
    groupToggles: { read: false, research: false, drafts: false, write: false },
    bearerFallback: {
      enabled: false,
      allowedClientKinds: ["claude_code", "codex_cli", "gemini_cli", "copilot_mcp", "generic_mcp"],
      maxLifetimeDays: 30,
      maxActiveConnectorsPerUser: 3,
      allowedToolGroups: ["read"],
    },
    inactivityExpiryDays: 90,
    expirationWarningDays: 7,
    freshAuthMaxAgeMs: 600_000,
    maxConnectorLifetimeDays: 90,
    postedTransactionMutationBatchLimit: 50,
    oauthPublicIssuer: "https://api.example.com",
    oauthRedirectUriAllowlist: [],
    oauthTokenSecretSet: true,
    readiness: {
      status: "degraded",
      endpoint: "https://api.example.com/mcp",
      deploymentEnabled: true,
      publicIssuerConfigured: true,
      oauthTokenSecretConfigured: true,
      mcpUrlReady: true,
      enabledClientKindCount: 6,
      totalClientKindCount: 6,
      highRiskToolsEnabled: false,
      bearerFallbackEnabled: false,
      checks: [
        { key: "deployment", status: "ok" },
        { key: "public_issuer", status: "ok" },
        { key: "oauth_token_secret", status: "ok" },
        { key: "mcp_url", status: "ok" },
        { key: "client_kind_policy", status: "ok" },
        { key: "high_risk_tools", status: "info" },
        { key: "bearer_fallback", status: "info" },
      ],
    },
    updatedAt: "2026-05-23T12:00:00.000Z",
    ...overrides,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setTextareaValue(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AdminSettingsClient — MCP settings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockGetJson.mockReset();
    mockPatchJson.mockReset();
    mockPostJson.mockReset();
    mockParams = new URLSearchParams({ tab: "mcp" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("warns admins when every MCP tool group is disabled", async () => {
    mockGetJson.mockResolvedValue(buildPolicy());

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    expect(mockGetJson).toHaveBeenCalledWith("/admin/mcp/settings");
    const alerts = Array.from(document.querySelectorAll("[role='alert']"));
    expect(alerts.some((alert) => alert.textContent?.includes("All MCP tool groups are disabled"))).toBe(true);
  });

  it("renders MCP tool groups, redirect callback examples, and audit-impact guidance", async () => {
    mockGetJson.mockResolvedValue(buildPolicy({ groupToggles: { read: true, research: false, drafts: true, write: false } }));

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    const section = document.querySelector("[data-testid='admin-settings-mcp-section']");
    expect(section?.textContent).toContain("Audit impact");
    expect(section?.textContent).toContain("Rotating or clearing the OAuth secret revokes OAuth connector credentials only");
    expect(section?.textContent).toContain("Tool groups");
    expect(section?.textContent).toContain("Read");
    expect(section?.textContent).toContain("Draft workflow");
    expect(section?.textContent).toContain("Account management and posting");
    expect(section?.textContent).toContain("https://chatgpt.com/connector/oauth/<connector-id>");
    expect(section?.textContent).toContain("https://chatgpt.com/aip/<gpt-id>/oauth/callback");
    expect(section?.textContent).toContain("https://claude.ai/api/mcp/auth_callback");
    expect(section?.textContent).toContain("Copy callback");
    expect(section?.textContent).toContain("Quick-add Claude.ai");
    expect(document.querySelector("#client-kind-allowlist")?.textContent).toContain("Client-kind allowlist");
    expect(document.querySelector("#bearer-fallback-policy")?.textContent).toContain("Bearer fallback policy");
    expect(document.querySelector("#bearer-tool-groups")?.textContent).toContain("Allowed bearer tool groups");

    const builtInCallbacks = document.querySelector("[data-testid='admin-settings-mcp-built-in-callbacks']");
    const suggestedCallbacks = document.querySelector("[data-testid='admin-settings-mcp-suggested-callbacks']");
    expect(builtInCallbacks?.textContent).not.toContain("claude.ai");
    expect(suggestedCallbacks?.textContent).toContain("https://claude.ai/api/mcp/auth_callback");
  });

  it("renders research rollout visibility only when MCP settings expose additive research state", async () => {
    mockGetJson.mockResolvedValue({
      ...buildPolicy({
        groupToggles: { ...buildPolicy().groupToggles, read: true, research: true },
        bearerFallback: {
          ...buildPolicy().bearerFallback,
          enabled: true,
          allowedToolGroups: ["read", "research"],
        },
      }),
      researchRollout: {
        acquisitionEnabled: true,
        mcpExposureEnabled: true,
        skillExposureEnabled: false,
      },
    });

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    const section = document.querySelector("[data-testid='admin-settings-mcp-section']");
    expect(section?.textContent).toContain("Research rollout");
    expect(section?.textContent).toContain("Research acquisition");
    expect(section?.textContent).toContain("Research MCP exposure");
    expect(section?.textContent).toContain("Research Skill exposure");
    expect(section?.textContent).toContain("Research");
    expect(section?.textContent).toContain("search_instruments (TW research path)");
    expect(section?.textContent).toContain("adding research requires reconnect or recreate");
  });

  it("renders the initial research controls when rollout metadata is present but every research policy toggle is off", async () => {
    mockGetJson.mockResolvedValue({
      ...buildPolicy(),
      researchRollout: {
        acquisitionEnabled: false,
        mcpExposureEnabled: false,
        skillExposureEnabled: false,
      },
    });

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    const section = document.querySelector("[data-testid='admin-settings-mcp-section']");
    expect(section?.textContent).toContain("Research rollout");
    expect(section?.textContent).toContain("Research");
    expect(section?.textContent).toContain("search_instruments (TW research path)");
    expect(document.querySelector("#bearer-tool-groups")?.textContent).toContain("research");
  });

  it("edits numeric MCP limits locally and saves them explicitly", async () => {
    mockGetJson.mockResolvedValue(buildPolicy({ groupToggles: { read: true, research: false, drafts: true, write: false } }));
    mockPostJson.mockResolvedValue({ freshAuthToken: "fresh-1" });
    mockPatchJson.mockResolvedValue(buildPolicy({
      groupToggles: { read: true, research: false, drafts: true, write: false },
      maxActiveConnectionsPerUser: 10,
    }));

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    const section = document.querySelector("[data-testid='admin-settings-mcp-section']");
    expect(section).not.toBeNull();
    const maxActiveInput = Array.from(section!.querySelectorAll("input[type='number']"))
      .find((input) => input.closest("label")?.textContent?.includes("Max active connectors")) as HTMLInputElement | undefined;
    expect(maxActiveInput).toBeTruthy();

    await act(async () => {
      setInputValue(maxActiveInput!, "10");
    });

    expect(mockPostJson).not.toHaveBeenCalled();
    expect(mockPatchJson).not.toHaveBeenCalled();

    const saveButton = Array.from(section!.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Save limits")) as HTMLButtonElement | undefined;
    expect(saveButton).toBeTruthy();
    expect(saveButton!.disabled).toBe(false);
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockPostJson).toHaveBeenCalledWith("/admin/mcp/fresh-auth", {});
    expect(mockPatchJson).toHaveBeenCalledWith(
      "/admin/mcp/settings",
      expect.objectContaining({ maxActiveConnectionsPerUser: 10 }),
      { headers: { "x-vakwen-fresh-auth-at": "fresh-1" } },
    );
  });

  it("shows the posted-transaction batch-limit warning above 200 and still saves the value", async () => {
    mockGetJson.mockResolvedValue(buildPolicy({
      groupToggles: { read: true, research: false, drafts: true, write: true },
      postedTransactionMutationBatchLimit: 50,
    }));
    mockPostJson.mockResolvedValue({ freshAuthToken: "fresh-batch-limit" });
    mockPatchJson.mockResolvedValue(buildPolicy({
      groupToggles: { read: true, research: false, drafts: true, write: true },
      postedTransactionMutationBatchLimit: 250,
    }));

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    const batchInput = document.querySelector(
      "#admin-settings-posted-transaction-mutation-batch-limit",
    ) as HTMLInputElement | null;
    expect(batchInput).toBeTruthy();

    const tooltipTrigger = document.querySelector(
      "[data-testid='admin-settings-posted-transaction-mutation-batch-limit-tooltip-trigger']",
    ) as HTMLButtonElement | null;
    expect(tooltipTrigger).toBeTruthy();
    await act(async () => {
      tooltipTrigger!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      tooltipTrigger!.focus();
      await Promise.resolve();
    });
    await flushEffects();

    const tooltipContent = document.querySelector(
      "[data-testid='admin-settings-posted-transaction-mutation-batch-limit-tooltip-content']",
    );
    expect(tooltipContent?.textContent).toContain("payload or response failures");
    expect(tooltipContent?.textContent).toContain("preview or client timeouts");
    expect(tooltipContent?.textContent).toContain("longer account locks and revision conflicts");
    expect(tooltipContent?.textContent).not.toContain("Allow the AI client to stage larger posted-transaction update or delete previews");

    await act(async () => {
      setInputValue(batchInput!, "250");
    });

    const inlineWarning = document.querySelector(
      "#admin-settings-posted-transaction-mutation-batch-limit-warning",
    );
    expect(inlineWarning?.textContent).toContain("payload or response failures");
    expect(inlineWarning?.textContent).toContain("rebuild queue backlogs");

    const saveButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Save limits")) as HTMLButtonElement | undefined;
    expect(saveButton?.disabled).toBe(false);
    await act(async () => {
      saveButton!.click();
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockPatchJson).toHaveBeenCalledWith(
      "/admin/mcp/settings",
      expect.objectContaining({ postedTransactionMutationBatchLimit: 250 }),
      { headers: { "x-vakwen-fresh-auth-at": "fresh-batch-limit" } },
    );
  });

  it("shows redirect allowlist examples and saves exact redirect URI additions", async () => {
    mockGetJson.mockResolvedValue(buildPolicy({ groupToggles: { read: true, research: false, drafts: true, write: false } }));
    mockPostJson.mockResolvedValue({ freshAuthToken: "fresh-allowlist" });
    mockPatchJson.mockResolvedValue(buildPolicy({
      groupToggles: { read: true, research: false, drafts: true, write: false },
      oauthRedirectUriAllowlist: [
        "https://connector.example.com/oauth/callback",
        "https://chatgpt.com/connector/oauth/custom123",
      ],
    }));

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    const section = document.querySelector("[data-testid='admin-settings-mcp-section']");
    expect(section?.textContent).toContain("https://chatgpt.com/connector/oauth/<connector-id>");
    expect(section?.textContent).toContain("https://chatgpt.com/aip/<gpt-id>/oauth/callback");
    expect(section?.textContent).toContain("Copy callback");

    const textarea = document.querySelector(
      "[data-testid='admin-settings-mcp-redirect-allowlist']",
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    expect(textarea!.getAttribute("aria-describedby")).toContain("admin-settings-mcp-redirect-help");
    expect(textarea!.getAttribute("aria-describedby")).toContain("admin-settings-mcp-redirect-examples");
    expect(textarea!.hasAttribute("aria-invalid")).toBe(false);
    await act(async () => {
      setTextareaValue(
        textarea!,
        "https://connector.example.com/oauth/callback\nhttps://chatgpt.com/connector/oauth/custom123",
      );
    });

    const saveButton = Array.from(section!.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Save allowlist")) as HTMLButtonElement | undefined;
    expect(saveButton).toBeTruthy();
    expect(saveButton!.disabled).toBe(false);
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockPatchJson).toHaveBeenCalledWith(
      "/admin/mcp/settings",
      expect.objectContaining({
        oauthRedirectUriAllowlist: [
          "https://connector.example.com/oauth/callback",
          "https://chatgpt.com/connector/oauth/custom123",
        ],
      }),
      { headers: { "x-vakwen-fresh-auth-at": "fresh-allowlist" } },
    );
    expect(section?.textContent).toContain("Remove");
  });

  it("keeps an invalid redirect allowlist draft resettable and accessible", async () => {
    const savedAllowlist = ["https://connector.example.com/oauth/callback"];
    mockGetJson.mockResolvedValue(buildPolicy({
      groupToggles: { read: true, research: false, drafts: true, write: false },
      oauthRedirectUriAllowlist: savedAllowlist,
    }));

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    const section = document.querySelector("[data-testid='admin-settings-mcp-section']");
    const textarea = document.querySelector(
      "[data-testid='admin-settings-mcp-redirect-allowlist']",
    ) as HTMLTextAreaElement | null;
    expect(section).toBeTruthy();
    expect(textarea).toBeTruthy();

    await act(async () => {
      setTextareaValue(textarea!, `${savedAllowlist[0]}\nnot-a-url`);
    });

    expect(textarea!.getAttribute("aria-invalid")).toBe("true");
    expect(textarea!.getAttribute("aria-describedby")).toContain("admin-settings-mcp-redirect-error");
    expect(section!.textContent).toContain("Each redirect URI must be a valid URL.");

    const resetButton = Array.from(section!.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Reset allowlist")) as HTMLButtonElement | undefined;
    const saveButton = Array.from(section!.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Save allowlist")) as HTMLButtonElement | undefined;
    expect(resetButton).toBeTruthy();
    expect(saveButton).toBeTruthy();
    expect(resetButton!.disabled).toBe(false);
    expect(saveButton!.disabled).toBe(true);

    await act(async () => {
      resetButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(textarea!.value).toBe(savedAllowlist[0]);
    expect(textarea!.hasAttribute("aria-invalid")).toBe(false);
    expect(section!.textContent).not.toContain("Each redirect URI must be a valid URL.");
    expect(mockPatchJson).not.toHaveBeenCalled();
  });

  it("generates a 64-hex MCP OAuth token secret before rotating", async () => {
    mockGetJson.mockResolvedValue(buildPolicy({ groupToggles: { read: true, research: false, drafts: true, write: false } }));
    mockPostJson.mockResolvedValue({ freshAuthToken: "fresh-secret" });
    mockPatchJson.mockResolvedValue(buildPolicy({
      groupToggles: { read: true, research: false, drafts: true, write: false },
      oauthTokenSecretSet: true,
    }));

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    const rotate = document.querySelector(
      "[data-testid='admin-settings-mcp-oauth-token-secret-rotate-button']",
    ) as HTMLButtonElement | null;
    expect(rotate).toBeTruthy();
    await act(async () => {
      rotate!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const generate = document.querySelector(
      "[data-testid='admin-settings-mcp-oauth-token-secret-generate-button']",
    ) as HTMLButtonElement | null;
    expect(generate).toBeTruthy();
    await act(async () => {
      generate!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const submit = document.querySelector(
      "[data-testid='admin-settings-mcp-oauth-token-secret-rotate-submit']",
    ) as HTMLButtonElement | null;
    expect(submit).toBeTruthy();
    expect(submit!.disabled).toBe(false);
    await act(async () => {
      submit!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockPatchJson).toHaveBeenCalledWith(
      "/admin/mcp/settings",
      expect.objectContaining({
        mcpOauthTokenSecret: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
      { headers: { "x-vakwen-fresh-auth-at": "fresh-secret" } },
    );
  });
});
