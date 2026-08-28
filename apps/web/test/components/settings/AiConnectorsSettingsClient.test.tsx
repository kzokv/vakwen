import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  AiConnectorConnectionDto,
  AiConnectorPolicySettingsDto,
  AiConnectorToolCatalogEntryDto,
} from "@vakwen/shared-types";
import type { AiConnectorSummaryResponse } from "../../../features/ai-inbox/service";

const mockFetchAiConnectorSummary = vi.fn();
const mockFetchAiConnectorHistory = vi.fn();
const mockFetchAiConnectorLogs = vi.fn();
const mockHideAiConnectorHistory = vi.fn();
const mockUpdateAiConnector = vi.fn();
const mockRevokeAiConnector = vi.fn();
const mockCreateAiConnectorBearer = vi.fn();
const mockUseOptionalAppShellData = vi.fn();

vi.mock("../../../features/ai-inbox/service", () => ({
  createAiConnectorBearer: (...args: unknown[]) => mockCreateAiConnectorBearer(...args),
  fetchAiConnectorHistory: (...args: unknown[]) => mockFetchAiConnectorHistory(...args),
  fetchAiConnectorLogs: (...args: unknown[]) => mockFetchAiConnectorLogs(...args),
  fetchAiConnectorSummary: (...args: unknown[]) => mockFetchAiConnectorSummary(...args),
  hideAiConnectorHistory: (...args: unknown[]) => mockHideAiConnectorHistory(...args),
  updateAiConnector: (...args: unknown[]) => mockUpdateAiConnector(...args),
  revokeAiConnector: (...args: unknown[]) => mockRevokeAiConnector(...args),
}));

vi.mock("../../../components/layout/AppShellDataContext", () => ({
  useOptionalAppShellData: () => mockUseOptionalAppShellData(),
}));

import { AiConnectorsSettingsClient } from "../../../components/settings/AiConnectorsSettingsClient";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildPolicy(overrides: Partial<AiConnectorPolicySettingsDto> = {}): AiConnectorPolicySettingsDto {
  return {
    enabled: true,
    maxActiveConnectionsPerUser: 3,
    postedTransactionMutationBatchLimit: 50,
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
    groupToggles: { read: true, research: false, drafts: true, write: true },
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
    oauthPublicIssuer: "https://api.example.com",
    oauthRedirectUriAllowlist: [],
    oauthTokenSecretSet: true,
    readiness: {
      status: "ready",
      endpoint: "https://api.example.com/mcp",
      deploymentEnabled: true,
      publicIssuerConfigured: true,
      oauthTokenSecretConfigured: true,
      mcpUrlReady: true,
      enabledClientKindCount: 6,
      totalClientKindCount: 6,
      highRiskToolsEnabled: true,
      bearerFallbackEnabled: false,
      checks: [
        { key: "deployment", status: "ok" },
        { key: "public_issuer", status: "ok" },
        { key: "oauth_token_secret", status: "ok" },
        { key: "mcp_url", status: "ok" },
        { key: "client_kind_policy", status: "ok" },
        { key: "high_risk_tools", status: "warning" },
        { key: "bearer_fallback", status: "info" },
      ],
    },
    updatedAt: "2026-05-23T12:00:00.000Z",
    ...overrides,
  };
}

function buildConnection(overrides: Partial<AiConnectorConnectionDto> = {}): AiConnectorConnectionDto {
  return {
    id: "conn-1",
    provider: "chatgpt",
    vendor: "openai",
    clientKind: "chatgpt_app",
    authMode: "oauth",
    capabilities: ["oauth", "widgets", "interactive_ops", "deep_link_fallback"],
    displayName: "ChatGPT",
    status: "active",
    scopes: ["portfolio:mcp_read"],
    toolToggles: {},
    expiresAt: "2026-06-23T12:00:00.000Z",
    expiryNotifiedAt: null,
    lastUsedAt: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: "2026-05-23T12:00:00.000Z",
    updatedAt: "2026-05-23T12:00:00.000Z",
    ...overrides,
  };
}

function buildToolCatalogEntry(overrides: Partial<AiConnectorToolCatalogEntryDto> = {}): AiConnectorToolCatalogEntryDto {
  return {
    name: "get_portfolio_report",
    description: "Return a descriptive portfolio report.",
    scope: "portfolio:mcp_read",
    accessKind: "read",
    group: "read",
    inputSchema: {
      fields: [
        { name: "portfolioContextUserId", type: "string", required: false },
      ],
      rawSchema: {
        type: "object",
        properties: { portfolioContextUserId: { type: "string" } },
        required: [],
      },
    },
    enabledByPolicy: true,
    availability: "available",
    unavailableReason: null,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    effectiveAccess: [
      {
        connectionId: "conn-1",
        connectionDisplayName: "ChatGPT",
        clientKind: "chatgpt_app",
        status: "available",
        blockerCode: null,
      },
    ],
    ...overrides,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AiConnectorsSettingsClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockFetchAiConnectorLogs.mockReset();
    mockFetchAiConnectorHistory.mockReset();
    mockHideAiConnectorHistory.mockReset();
    mockFetchAiConnectorSummary.mockReset();
    mockUpdateAiConnector.mockReset();
    mockRevokeAiConnector.mockReset();
    mockCreateAiConnectorBearer.mockReset();
    mockUseOptionalAppShellData.mockReset();
    mockUseOptionalAppShellData.mockReturnValue({ locale: "en", sessionUserRole: "member" });
    mockFetchAiConnectorHistory.mockResolvedValue({ connections: [] });
    mockFetchAiConnectorLogs.mockResolvedValue({ accessLogs: [], nextOffset: null, hasMore: false });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/");
  });

  it("renders responsive section controls and policy recovery messaging", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [buildConnection()],
      policy: buildPolicy({ groupToggles: { read: false, research: false, drafts: false, write: false } }),
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    expect(document.body.textContent).toContain("AI Connectors");
    const overviewTab = document.querySelector("[data-testid='ai-connectors-tab-overview']");
    expect(overviewTab).not.toBeNull();
    expect(overviewTab?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector("[data-testid='ai-connectors-tab-connect']")).not.toBeNull();
    expect(document.querySelector("[data-testid='ai-connectors-tab-connections']")).not.toBeNull();
    const alert = document.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("Admin policy has disabled all MCP tool groups");
  });

  it("shows an admin repair CTA when setup is misconfigured", async () => {
    mockUseOptionalAppShellData.mockReturnValue({ locale: "en", sessionUserRole: "admin" });
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [],
      policy: buildPolicy({
        readiness: {
          ...buildPolicy().readiness,
          status: "disabled",
          deploymentEnabled: false,
          checks: [
            { key: "deployment", status: "blocked" },
            { key: "public_issuer", status: "ok" },
            { key: "oauth_token_secret", status: "ok" },
            { key: "mcp_url", status: "ok" },
            { key: "client_kind_policy", status: "ok" },
            { key: "high_risk_tools", status: "warning" },
            { key: "bearer_fallback", status: "info" },
          ],
        },
      }),
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    const repairState = document.querySelector("[data-testid='ai-connectors-repair-state']");
    expect(repairState?.textContent).toContain("Admin setup is required");
    const adminLink = document.querySelector("[data-testid='ai-connectors-admin-repair-link']") as HTMLAnchorElement | null;
    expect(adminLink?.getAttribute("href")).toBe("/admin/settings?tab=mcp");
  });

  it("shows ask-admin repair guidance for non-admin users", async () => {
    mockUseOptionalAppShellData.mockReturnValue({ locale: "en", sessionUserRole: "member" });
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [],
      policy: buildPolicy({
        readiness: {
          ...buildPolicy().readiness,
          status: "degraded",
          publicIssuerConfigured: false,
          checks: [
            { key: "deployment", status: "ok" },
            { key: "public_issuer", status: "blocked" },
            { key: "oauth_token_secret", status: "ok" },
            { key: "mcp_url", status: "blocked" },
            { key: "client_kind_policy", status: "ok" },
            { key: "high_risk_tools", status: "warning" },
            { key: "bearer_fallback", status: "info" },
          ],
        },
      }),
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connectors-repair-state']")?.textContent).toContain("Ask an admin");
    expect(document.querySelector("[data-testid='ai-connectors-admin-repair-link']")).toBeNull();
  });

  it("shows first-run guidance and jumps to Connect cards when MCP is ready", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [],
      policy: buildPolicy(),
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connectors-first-run-state']")?.textContent).toContain("Start with a client setup card");
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("View Connect cards"))
        ?.click();
    });
    expect(document.body.textContent).toContain("Connect clients");

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-permissions']") as HTMLButtonElement | null)?.click();
    });
    expect(document.querySelector("[data-testid='ai-connectors-permissions-empty']")?.textContent).toContain("No connector permissions");

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-tool-catalog']") as HTMLButtonElement | null)?.click();
    });
    expect(document.querySelector("[data-testid='ai-connectors-tool-catalog-empty']")?.textContent).toContain("No MCP tools are registered");
  });

  it("includes bearer auth placeholders in bearer-only setup snippets", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [],
      policy: buildPolicy({
        bearerFallback: {
          enabled: true,
          allowedClientKinds: ["claude_code", "codex_cli"],
          maxLifetimeDays: 30,
          maxActiveConnectorsPerUser: 3,
          allowedToolGroups: ["read"],
        },
      }),
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();
    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-connect']") as HTMLButtonElement | null)?.click();
    });

    expect(document.body.textContent).toContain(
      "claude mcp add --transport http vakwen https://api.example.com/mcp --header \"Authorization: Bearer <one-time-vakwen-token>\"",
    );
    expect(document.body.textContent).toContain("[mcp_servers.vakwen.headers]");
    expect(document.body.textContent).toContain("Authorization = \"Bearer <one-time-vakwen-token>\"");
  });

  it("keeps active connectors in Connections and exposes revoked rows in the dedicated History tab", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [
        buildConnection({ id: "conn-1", status: "active", displayName: "Primary ChatGPT" }),
        buildConnection({
          id: "pending-1",
          provider: "self_hosted",
          vendor: "generic",
          clientKind: "generic_mcp",
          authMode: "bearer",
          status: "pending",
          displayName: "Lab Connector",
        }),
      ],
      policy: buildPolicy(),
    } satisfies AiConnectorSummaryResponse);
    mockFetchAiConnectorHistory.mockResolvedValue({
      connections: [
        buildConnection({ id: "revoked-1", status: "revoked", displayName: "Old ChatGPT" }),
      ],
    });

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-connections']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    const cards = Array.from(document.querySelectorAll("[data-testid^='ai-connector-']"));
    expect(cards[0]?.textContent).toContain("Primary ChatGPT");
    expect(document.body.textContent).not.toContain("Connection tools");
    expect(document.querySelector("[data-testid='ai-connectors-history']")).toBeNull();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-history']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connectors-history']")?.textContent).toContain("Old ChatGPT");
    expect(document.querySelector("[data-testid='ai-connectors-history']")?.textContent).toContain("Remove from history");
  });

  it("keeps expired or revoked rows out of permissions while preserving the active Anthropic OAuth connector", async () => {
    const expiredCodex = buildConnection({
      id: "expired-codex",
      provider: "self_hosted",
      vendor: "openai_codex",
      clientKind: "codex_cli",
      authMode: "bearer",
      displayName: "Expired Codex",
      status: "expired",
    });
    const revokedChatGpt = buildConnection({
      id: "revoked-chatgpt",
      displayName: "Revoked ChatGPT",
      status: "revoked",
    });
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [
        buildConnection({
          id: "claude-oauth",
          provider: "self_hosted",
          vendor: "anthropic",
          clientKind: "claude_code",
          authMode: "oauth",
          displayName: "Claude browser",
          scopes: ["portfolio:mcp_read"],
        }),
      ],
      policy: buildPolicy(),
      toolCatalog: [buildToolCatalogEntry()],
    } satisfies AiConnectorSummaryResponse);
    mockFetchAiConnectorHistory.mockResolvedValue({
      connections: [expiredCodex, revokedChatGpt],
    });

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-connections']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(document.body.textContent).toContain("Claude browser");
    expect(document.body.textContent).toContain("Claude Code");
    expect(document.querySelector("[data-testid='ai-connectors-history']")).toBeNull();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-history']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connectors-history']")?.textContent).toContain("Expired Codex");
    expect(document.querySelector("[data-testid='ai-connectors-history']")?.textContent).toContain("Revoked ChatGPT");

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-permissions']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(document.body.textContent).toContain("Claude browser");
    expect(document.body.textContent).not.toContain("Expired Codex");
    expect(document.body.textContent).not.toContain("Revoked ChatGPT");
  });

  it("renders the MCP tool catalog as the only searchable tool surface", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [buildConnection()],
      policy: buildPolicy(),
      toolCatalog: [
        buildToolCatalogEntry({ name: "get_daily_review_report" }),
        buildToolCatalogEntry({ name: "create_account", scope: "account:manage", group: "write", accessKind: "write" }),
        buildToolCatalogEntry({
          name: "delete_draft",
          scope: "transaction_draft:delete",
          group: "drafts",
          accessKind: "draft_delete",
          availability: "unavailable",
          unavailableReason: "Draft tools disabled.",
          effectiveAccess: [
            {
              connectionId: "conn-1",
              connectionDisplayName: "ChatGPT",
              clientKind: "chatgpt_app",
              status: "blocked",
              blockerCode: "admin_tool_policy_disabled",
            },
          ],
        }),
      ],
    } satisfies AiConnectorSummaryResponse);
    mockFetchAiConnectorLogs.mockResolvedValue({
      accessLogs: [
        {
          id: "log-delete-denied",
          connectionId: "conn-1",
          connectionDisplayName: "ChatGPT",
          clientKind: "chatgpt_app",
          portfolioContextUserId: "user-1",
          shareId: null,
          toolName: "delete_draft",
          accessKind: "draft_delete",
          result: "denied",
          denialReason: "Draft tools disabled.",
          createdAt: "2026-06-02T00:00:00.000Z",
        },
      ],
      nextOffset: null,
      hasMore: false,
    });

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connectors-tab-tool-catalog']")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Connection tools");

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-tool-catalog']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connectors-tool-search']")).not.toBeNull();
    expect(document.body.textContent).toContain("get_daily_review_report");
    expect(document.body.textContent).toContain("available");
    expect(document.body.textContent).toContain("delete_draft");
    expect(document.body.textContent).toContain("unavailable");
    expect(document.body.textContent).toContain("Recent outcomes: denied · ChatGPT · chatgpt_app · Draft delete");

    const search = document.querySelector("[data-testid='ai-connectors-tool-search']") as HTMLInputElement;
    setInputValue(search, "daily");
    expect(document.body.textContent).toContain("get_daily_review_report");
    expect(document.body.textContent).not.toContain("create_account");

    setInputValue(search, "");
    expect(document.body.textContent).toContain("get_daily_review_report");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(max-width: 1279px)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("delete_draft"))
        ?.click();
    });
    expect(document.body.textContent).toContain("Draft tools disabled.");
    const sheet = document.querySelector("[role='dialog']");
    expect(sheet?.textContent).toContain("delete_draft");
    expect(document.body.textContent).toContain("Schema summary");
    expect(document.body.textContent).toContain("portfolioContextUserId");
    expect(document.body.textContent).toContain("Optional");
    expect(document.body.textContent).toContain("Raw schema");
    expect(document.body.textContent).toContain("Recent outcomes");
    expect(document.body.textContent).toContain("denied");
    expect(document.body.textContent).toContain("ChatGPT");
  });

  it("limits tool detail recent outcomes to the latest five calls", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [buildConnection()],
      policy: buildPolicy(),
      toolCatalog: [buildToolCatalogEntry()],
    } satisfies AiConnectorSummaryResponse);
    mockFetchAiConnectorLogs.mockResolvedValue({
      accessLogs: [
        {
          id: "log-6",
          connectionId: "conn-1",
          connectionDisplayName: "ChatGPT",
          clientKind: "chatgpt_app",
          portfolioContextUserId: "user-1",
          shareId: null,
          toolName: "get_portfolio_report",
          accessKind: "read",
          result: "ok",
          denialReason: null,
          createdAt: "2026-06-02T00:00:06.000Z",
        },
        {
          id: "log-5",
          connectionId: "conn-1",
          connectionDisplayName: "ChatGPT",
          clientKind: "chatgpt_app",
          portfolioContextUserId: "user-1",
          shareId: null,
          toolName: "get_portfolio_report",
          accessKind: "read",
          result: "denied",
          denialReason: "Most recent denied",
          createdAt: "2026-06-02T00:00:05.000Z",
        },
        {
          id: "log-4",
          connectionId: "conn-1",
          connectionDisplayName: "ChatGPT",
          clientKind: "chatgpt_app",
          portfolioContextUserId: "user-1",
          shareId: null,
          toolName: "get_portfolio_report",
          accessKind: "read",
          result: "ok",
          denialReason: null,
          createdAt: "2026-06-02T00:00:04.000Z",
        },
        {
          id: "log-3",
          connectionId: "conn-1",
          connectionDisplayName: "ChatGPT",
          clientKind: "chatgpt_app",
          portfolioContextUserId: "user-1",
          shareId: null,
          toolName: "get_portfolio_report",
          accessKind: "read",
          result: "error",
          denialReason: "Third newest error",
          createdAt: "2026-06-02T00:00:03.000Z",
        },
        {
          id: "log-2",
          connectionId: "conn-1",
          connectionDisplayName: "ChatGPT",
          clientKind: "chatgpt_app",
          portfolioContextUserId: "user-1",
          shareId: null,
          toolName: "get_portfolio_report",
          accessKind: "read",
          result: "ok",
          denialReason: null,
          createdAt: "2026-06-02T00:00:02.000Z",
        },
        {
          id: "log-1",
          connectionId: "conn-1",
          connectionDisplayName: "ChatGPT",
          clientKind: "chatgpt_app",
          portfolioContextUserId: "user-1",
          shareId: null,
          toolName: "get_portfolio_report",
          accessKind: "read",
          result: "denied",
          denialReason: "Oldest denied entry",
          createdAt: "2026-06-02T00:00:01.000Z",
        },
      ],
      nextOffset: null,
      hasMore: false,
    });

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-tool-catalog']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(max-width: 1279px)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("get_portfolio_report"))
        ?.click();
    });

    expect(document.body.textContent).toContain("Recent outcomes (5)");
    expect(document.body.textContent).toContain("Most recent denied");
    expect(document.body.textContent).toContain("Third newest error");
    expect(document.body.textContent).not.toContain("Oldest denied entry");
  });

  it("locks bearer permission scope expansion while allowing existing grants to narrow", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [
        buildConnection({
          id: "bearer-locked",
          provider: "self_hosted",
          vendor: "openai_codex",
          clientKind: "codex_cli",
          authMode: "bearer",
          capabilities: ["bearer_fallback", "deep_link_fallback"],
          displayName: "Codex CLI",
          scopes: ["portfolio:mcp_read"],
        }),
      ],
      policy: buildPolicy({
        bearerFallback: {
          enabled: true,
          allowedClientKinds: ["codex_cli"],
          maxLifetimeDays: 30,
          maxActiveConnectorsPerUser: 3,
          allowedToolGroups: ["read", "drafts"],
        },
      }),
      toolCatalog: [buildToolCatalogEntry()],
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-permissions']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    const readLabel = Array.from(document.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Read portfolio data"));
    const draftLabel = Array.from(document.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Create transaction drafts"));
    const readInput = readLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;
    const draftInput = draftLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    expect(readInput?.checked).toBe(true);
    expect(readInput?.disabled).toBe(false);
    expect(draftInput?.checked).toBe(false);
    expect(draftInput?.disabled).toBe(true);
    expect(draftLabel?.textContent).toContain("Bearer token grants are fixed");
    expect(mockUpdateAiConnector).not.toHaveBeenCalled();
  });

  it("locks OAuth permission scope expansion behind reconnect", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [
        buildConnection({
          id: "oauth-locked",
          provider: "chatgpt",
          vendor: "openai",
          clientKind: "chatgpt_app",
          authMode: "oauth",
          displayName: "ChatGPT",
          scopes: ["portfolio:mcp_read"],
        }),
      ],
      policy: buildPolicy(),
      toolCatalog: [buildToolCatalogEntry()],
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-permissions']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    const readLabel = Array.from(document.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Read portfolio data"));
    const draftLabel = Array.from(document.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Create transaction drafts"));
    const readInput = readLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;
    const draftInput = draftLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    expect(readInput?.checked).toBe(true);
    expect(readInput?.disabled).toBe(false);
    expect(draftInput?.checked).toBe(false);
    expect(draftInput?.disabled).toBe(true);
    expect(draftLabel?.textContent).toContain("OAuth consent is fixed");
    expect(mockUpdateAiConnector).not.toHaveBeenCalled();
  });

  it("renders additive research scope guidance only when the API exposes it", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [
        buildConnection({
          id: "oauth-research",
          provider: "chatgpt",
          vendor: "openai",
          clientKind: "chatgpt_app",
          authMode: "oauth",
          displayName: "ChatGPT",
          scopes: ["portfolio:mcp_read"],
        }),
      ],
      policy: {
        ...buildPolicy(),
        groupToggles: { ...buildPolicy().groupToggles, research: true },
        bearerFallback: {
          ...buildPolicy().bearerFallback,
          allowedToolGroups: [...buildPolicy().bearerFallback.allowedToolGroups, "research"],
        },
      },
      toolCatalog: [
        buildToolCatalogEntry(),
        buildToolCatalogEntry({
          name: "search_instruments",
          alternativeScopes: ["research:read"],
          description: "Search Taiwan research identities without broadening legacy read access.",
          inputSchema: {
            fields: [
              { name: "includeInactive", type: "boolean", required: false },
              { name: "query", type: "string", required: true },
            ],
            rawSchema: {
              type: "object",
              properties: {
                includeInactive: { type: "boolean" },
                query: { type: "string" },
              },
              required: ["query"],
            },
          },
          effectiveAccess: [
            {
              connectionId: "oauth-research",
              connectionDisplayName: "ChatGPT",
              clientKind: "chatgpt_app",
              status: "blocked",
              blockerCode: "missing_scope",
            },
          ],
        }),
      ],
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-permissions']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    const researchLabel = Array.from(document.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Research identities for Taiwan additive workflows"));
    const researchInput = researchLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    expect(document.body.textContent).toContain("Research");
    expect(researchInput?.checked).toBe(false);
    expect(researchInput?.disabled).toBe(true);
    expect(researchLabel?.textContent).toContain("Reconnect this OAuth connector");
    expect(researchLabel?.textContent).toContain("Taiwan research workflows");

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-tool-catalog']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(document.querySelector("[aria-label='Search tools']")).not.toBeNull();
    expect(document.querySelector("[aria-label='Group']")).not.toBeNull();
    expect(document.querySelector("[aria-label='Required scope']")).not.toBeNull();
    const researchSearch = document.querySelector("[data-testid='ai-connectors-tool-search']") as HTMLInputElement;
    setInputValue(researchSearch, "Research identities for Taiwan additive workflows");
    expect(document.body.textContent).toContain("search_instruments");
    setInputValue(researchSearch, "");
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("search_instruments"))
        ?.click();
    });
    await flushEffects();

    expect(document.body.textContent).toContain("Alternative scopes");
    expect(document.body.textContent).toContain("This tool also authorizes through these additive scopes");
    expect(document.body.textContent).toContain("Read portfolio data");
    expect(document.body.textContent).toContain("Research identities for Taiwan additive workflows");
  });

  it("groups dividend write with posting permissions and marks it as advanced", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [
        buildConnection({
          id: "write-conn",
          scopes: ["portfolio:mcp_read", "dividend:write"],
        }),
      ],
      policy: buildPolicy(),
      toolCatalog: [buildToolCatalogEntry({ scope: "dividend:write", group: "write", name: "post_dividend_receipt" })],
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-permissions']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(document.body.textContent).toContain("Posting");
    expect(document.body.textContent).toContain("Write dividends and related portfolio accounting adjustments");
    expect(document.body.textContent).toContain("Advanced financial write");
  });

  it("refreshes derived tool access after narrowing connector scopes", async () => {
    const connection = buildConnection({
      id: "scope-refresh",
      scopes: ["portfolio:mcp_read", "transaction_draft:create"],
    });
    const narrowed = { ...connection, scopes: ["transaction_draft:create"] as AiConnectorConnectionDto["scopes"] };
    mockFetchAiConnectorSummary
      .mockResolvedValueOnce({
        connections: [connection],
        policy: buildPolicy(),
        toolCatalog: [buildToolCatalogEntry()],
      } satisfies AiConnectorSummaryResponse)
      .mockResolvedValueOnce({
        connections: [narrowed],
        policy: buildPolicy(),
        toolCatalog: [
          buildToolCatalogEntry({
            effectiveAccess: [
              {
                connectionId: "scope-refresh",
                connectionDisplayName: "ChatGPT",
                clientKind: "chatgpt_app",
                status: "blocked",
                blockerCode: "missing_scope",
              },
            ],
          }),
        ],
      } satisfies AiConnectorSummaryResponse);
    mockUpdateAiConnector.mockResolvedValue(narrowed);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-permissions']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    const readLabel = Array.from(document.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Read portfolio data"));
    const readInput = readLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    await act(async () => {
      readInput?.click();
    });
    await flushEffects();

    expect(mockUpdateAiConnector).toHaveBeenCalledWith("scope-refresh", {
      scopes: ["transaction_draft:create"],
    });
    expect(mockFetchAiConnectorSummary).toHaveBeenCalledTimes(2);
  });

  it("blocks tool overrides when effective access is missing", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [buildConnection()],
      policy: buildPolicy(),
      toolCatalog: [
        buildToolCatalogEntry({
          effectiveAccess: [],
        }),
      ],
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-permissions']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    const toolLabel = Array.from(document.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("get_portfolio_report"));
    const toolInput = toolLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    expect(toolInput?.checked).toBe(false);
    expect(toolInput?.disabled).toBe(true);
    expect(toolLabel?.textContent).toContain("Blocked by admin MCP policy");
  });

  it("loads revoked and expired connections from the history endpoint", async () => {
    const revokedConnection = buildConnection({
      id: "revoked-claude",
      provider: "chatgpt",
      vendor: "anthropic",
      clientKind: "claude_ai_connector",
      authMode: "oauth",
      capabilities: ["oauth", "deep_link_fallback"],
      displayName: "Claude.ai",
      status: "revoked",
      revokedAt: "2026-06-23T12:00:00.000Z",
      revocationReason: "user_revoked",
    });
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [],
      policy: buildPolicy(),
      toolCatalog: [],
    } satisfies AiConnectorSummaryResponse);
    mockFetchAiConnectorHistory.mockResolvedValue({
      connections: [revokedConnection],
    });

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-history']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(mockFetchAiConnectorHistory).toHaveBeenCalledWith();
    expect(document.querySelector("[data-testid='ai-connectors-history']")?.textContent).toContain("Claude.ai");
    expect(document.querySelector("[data-testid='ai-connectors-repair-state']")).toBeNull();
  });

  it("allows disabled tool overrides to be re-enabled", async () => {
    const disabledConnection = buildConnection({
      toolToggles: { get_portfolio_report: false },
    });
    const enabledConnection = buildConnection({
      toolToggles: { get_portfolio_report: true },
    });
    mockFetchAiConnectorSummary
      .mockResolvedValueOnce({
        connections: [disabledConnection],
        policy: buildPolicy(),
        toolCatalog: [
          buildToolCatalogEntry({
            effectiveAccess: [
              {
                connectionId: "conn-1",
                connectionDisplayName: "ChatGPT",
                clientKind: "chatgpt_app",
                status: "blocked",
                blockerCode: "connector_override_disabled",
              },
            ],
          }),
        ],
      } satisfies AiConnectorSummaryResponse)
      .mockResolvedValueOnce({
        connections: [enabledConnection],
        policy: buildPolicy(),
        toolCatalog: [buildToolCatalogEntry()],
      } satisfies AiConnectorSummaryResponse);
    mockUpdateAiConnector.mockResolvedValue(enabledConnection);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-permissions']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    const toolLabel = Array.from(document.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("get_portfolio_report"));
    const toolInput = toolLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    expect(toolInput?.checked).toBe(false);
    expect(toolInput?.disabled).toBe(false);

    await act(async () => {
      toolInput?.click();
    });
    await flushEffects();

    expect(mockUpdateAiConnector).toHaveBeenCalledWith("conn-1", {
      toolToggles: { get_portfolio_report: true },
    });
    expect(mockFetchAiConnectorSummary).toHaveBeenCalledTimes(2);
  });

  it("creates a bearer fallback connector from an eligible Connect card and shows the token once", async () => {
    const bearerConnection = buildConnection({
      id: "bearer-1",
      provider: "self_hosted",
      vendor: "anthropic",
      clientKind: "claude_code",
      authMode: "bearer",
      capabilities: ["bearer_fallback", "deep_link_fallback"],
      displayName: "Claude Code",
      expiresAt: "2026-07-23T12:00:00.000Z",
    });
    mockCreateAiConnectorBearer.mockResolvedValue({
      connection: bearerConnection,
      bearerToken: "vakwen_mcp_example_token",
      tokenHint: "oken",
      expiresAt: "2026-07-23T12:00:00.000Z",
    });
    const policy = buildPolicy({
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["claude_code", "codex_cli"],
        maxLifetimeDays: 45,
        maxActiveConnectorsPerUser: 3,
        allowedToolGroups: ["read", "drafts"],
      },
    });
    mockFetchAiConnectorSummary
      .mockResolvedValueOnce({
        connections: [],
        policy,
      } satisfies AiConnectorSummaryResponse)
      .mockResolvedValueOnce({
        connections: [bearerConnection],
        policy,
        toolCatalog: [
          buildToolCatalogEntry({
            effectiveAccess: [
              {
                connectionId: "bearer-1",
                connectionDisplayName: "Claude Code",
                clientKind: "claude_code",
                status: "available",
                blockerCode: null,
              },
            ],
          }),
        ],
      } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();
    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-connect']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-bearer-open-claude_code']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(document.body.textContent).toContain("Connector name");
    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-bearer-submit-claude_code']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(mockCreateAiConnectorBearer).toHaveBeenCalledWith({
      clientKind: "claude_code",
      displayName: "Claude Code",
      lifetimeDays: 30,
      scopes: ["portfolio:mcp_read"],
    });
    expect(mockFetchAiConnectorSummary).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("One-time bearer token");
    expect(document.body.textContent).toContain("vakwen_mcp_example_token");

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-bearer-open-codex_cli']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(document.body.textContent).toContain("Codex CLI");
    expect(document.body.textContent).not.toContain("vakwen_mcp_example_token");
  });

  it("does not seed disabled read scope into bearer setup drafts", async () => {
    const bearerConnection = buildConnection({
      id: "bearer-drafts",
      provider: "self_hosted",
      vendor: "anthropic",
      clientKind: "claude_code",
      authMode: "bearer",
      capabilities: ["bearer_fallback", "deep_link_fallback"],
      displayName: "Claude Code",
    });
    mockCreateAiConnectorBearer.mockResolvedValue({
      connection: bearerConnection,
      bearerToken: "vakwen_mcp_drafts_token",
      tokenHint: "oken",
      expiresAt: "2026-07-23T12:00:00.000Z",
    });
    const policy = buildPolicy({
      groupToggles: { read: false, research: false, drafts: true, write: true },
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["claude_code", "codex_cli"],
        maxLifetimeDays: 45,
        maxActiveConnectorsPerUser: 3,
        allowedToolGroups: ["drafts"],
      },
    });
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [],
      policy,
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();
    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-connect']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-bearer-open-claude_code']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    const labels = Array.from(document.querySelectorAll("label"));
    const readInput = labels.find((label) => label.textContent?.includes("Read portfolio data"))?.querySelector("input") as HTMLInputElement | null;
    const createDraftInput = labels.find((label) => label.textContent?.includes("Create transaction drafts"))?.querySelector("input") as HTMLInputElement | null;
    const submit = document.querySelector("[data-testid='ai-connectors-bearer-submit-claude_code']") as HTMLButtonElement | null;

    expect(readInput?.disabled).toBe(true);
    expect(readInput?.checked).toBe(false);
    expect(createDraftInput?.disabled).toBe(false);
    expect(createDraftInput?.checked).toBe(false);
    expect(submit?.disabled).toBe(true);

    await act(async () => {
      createDraftInput?.click();
    });
    await flushEffects();

    expect(createDraftInput?.checked).toBe(true);
    expect(submit?.disabled).toBe(false);

    await act(async () => {
      submit?.click();
    });
    await flushEffects();

    expect(mockCreateAiConnectorBearer).toHaveBeenCalledWith({
      clientKind: "claude_code",
      displayName: "Claude Code",
      lifetimeDays: 30,
      scopes: ["transaction_draft:create"],
    });
  });

  it("keeps bearer creation visible with precise blockers when a client is disabled", async () => {
    const basePolicy = buildPolicy();
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [],
      policy: buildPolicy({
        allowedClientKinds: {
          ...basePolicy.allowedClientKinds,
          codex_cli: false,
        },
        bearerFallback: {
          enabled: true,
          allowedClientKinds: ["codex_cli"],
          maxLifetimeDays: 30,
          maxActiveConnectorsPerUser: 3,
          allowedToolGroups: ["read"],
        },
      }),
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();
    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-connect']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    const openButton = document.querySelector("[data-testid='ai-connectors-bearer-open-codex_cli']") as HTMLButtonElement | null;
    expect(openButton).not.toBeNull();
    expect(openButton?.disabled).toBe(true);
    expect(document.body.textContent).toContain("This AI client is disabled in the client-kind allowlist.");
    expect(document.body.textContent).not.toContain("No bearer tool groups are enabled");
    expect(document.querySelector("a[href='/admin/settings?tab=mcp#client-kind-allowlist']")).toBeNull();
  });

  it("explains when bearer creation is blocked by tool-group policy", async () => {
    mockUseOptionalAppShellData.mockReturnValue({ locale: "en", sessionUserRole: "admin" });
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [],
      policy: buildPolicy({
        groupToggles: { read: true, research: false, drafts: true, write: true },
        bearerFallback: {
          enabled: true,
          allowedClientKinds: ["codex_cli"],
          maxLifetimeDays: 30,
          maxActiveConnectorsPerUser: 3,
          allowedToolGroups: [],
        },
      }),
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();
    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-connect']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    const openButton = document.querySelector("[data-testid='ai-connectors-bearer-open-codex_cli']") as HTMLButtonElement | null;
    expect(openButton).not.toBeNull();
    expect(openButton?.disabled).toBe(true);
    expect(document.body.textContent).toContain("No bearer tool groups are enabled for the currently available MCP tool groups.");
    const repairLink = document.querySelector("a[href='/admin/settings?tab=mcp#bearer-tool-groups']");
    expect(repairLink?.textContent).toContain("Open admin setting");
  });

  it("loads access logs after the summary resolves", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [buildConnection()],
      policy: buildPolicy(),
    } satisfies AiConnectorSummaryResponse);
    mockFetchAiConnectorLogs.mockResolvedValue({
      accessLogs: [
        {
          id: "log-1",
          connectionId: "conn-1",
          portfolioContextUserId: "user-1",
          shareId: null,
          toolName: "portfolio.read",
          accessKind: "tool",
          result: "ok",
          denialReason: null,
          createdAt: "2026-06-02T00:00:00.000Z",
        },
      ],
    });

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();
    await flushEffects();

    expect(mockFetchAiConnectorLogs).toHaveBeenCalledWith({
      limit: 12,
      result: undefined,
      search: "",
      connectionId: undefined,
    });
    expect(document.querySelector("[data-testid='ai-connectors-tab-activity']")).not.toBeNull();
    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-activity']") as HTMLButtonElement | null)?.click();
    });
    expect(document.body.textContent).toContain("portfolio.read");
  });

  it("hydrates the Activity section from query state and carries the search into the logs request", async () => {
    window.history.replaceState(null, "", "/settings/ai-connectors?section=activity&activitySearch=denied");
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [buildConnection()],
      policy: buildPolicy(),
    } satisfies AiConnectorSummaryResponse);
    mockFetchAiConnectorLogs.mockResolvedValue({
      accessLogs: [
        {
          id: "log-denied-1",
          connectionId: "conn-1",
          connectionDisplayName: "ChatGPT",
          clientKind: "chatgpt_app",
          portfolioContextUserId: "user-1",
          shareId: null,
          toolName: "delete_draft",
          accessKind: "draft_delete",
          result: "denied",
          denialReason: "Blocked by policy.",
          createdAt: "2026-06-02T00:00:00.000Z",
        },
      ],
      nextOffset: null,
      hasMore: false,
    });

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connectors-tab-activity']")?.getAttribute("aria-current")).toBe("page");
    expect(mockFetchAiConnectorLogs).toHaveBeenCalledWith({
      limit: 12,
      offset: 0,
      result: undefined,
      search: "denied",
      connectionId: undefined,
    });
    expect(document.body.textContent).toContain("delete_draft");
    expect(window.location.search).toContain("section=activity");
    expect(window.location.search).toContain("activitySearch=denied");
  });

  it("supports History filters, details, Activity deep-linking, and single/bulk remove", async () => {
    const revoked = buildConnection({
      id: "revoked-1",
      displayName: "Old ChatGPT",
      status: "revoked",
      revokedAt: "2026-06-27T12:00:00.000Z",
      revocationReason: "User revoked",
    });
    const expired = buildConnection({
      id: "expired-claude",
      provider: "self_hosted",
      vendor: "anthropic",
      clientKind: "claude_ai_connector",
      authMode: "oauth",
      displayName: "Claude.ai Browser",
      status: "expired",
      expiresAt: "2026-06-27T12:00:00.000Z",
    });
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [buildConnection()],
      policy: buildPolicy(),
    } satisfies AiConnectorSummaryResponse);
    mockFetchAiConnectorHistory.mockResolvedValue({ connections: [revoked, expired] });
    mockHideAiConnectorHistory.mockResolvedValue(revoked);
    mockFetchAiConnectorLogs.mockResolvedValue({
      accessLogs: [
        {
          id: "detail-log-1",
          connectionId: "expired-claude",
          connectionDisplayName: "Claude.ai Browser",
          clientKind: "claude_ai_connector",
          portfolioContextUserId: "user-1",
          shareId: null,
          toolName: "get_portfolio_report",
          accessKind: "read",
          result: "ok",
          denialReason: null,
          createdAt: "2026-06-28T00:00:00.000Z",
        },
      ],
      nextOffset: null,
      hasMore: false,
    });

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();
    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-history']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connectors-history']")?.textContent).toContain("Old ChatGPT");
    const search = document.querySelector("[data-testid='ai-connectors-history-search']") as HTMLInputElement;
    setInputValue(search, "Claude");
    expect(document.querySelector("[data-testid='ai-connectors-history']")?.textContent).toContain("Claude.ai Browser");
    expect(document.querySelector("[data-testid='ai-connectors-history']")?.textContent).not.toContain("Old ChatGPT");

    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent === "Details")
        ?.click();
    });
    await flushEffects();
    expect(mockFetchAiConnectorLogs).toHaveBeenCalledWith({ limit: 5, connectionId: "expired-claude" });
    expect(document.querySelector("[role='dialog']")?.textContent).toContain("Connection details");
    expect(document.querySelector("[role='dialog']")?.textContent).toContain("get_portfolio_report");

    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("View all calls in Activity"))
        ?.click();
    });
    await flushEffects();
    expect(window.location.search).toContain("section=activity");
    expect(window.location.search).toContain("connectionId=expired-claude");

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-history']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Remove from history"))
        ?.click();
    });
    await flushEffects();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Audit records are retained"));
    expect(mockHideAiConnectorHistory).toHaveBeenCalledWith("expired-claude");

    const visibleSearch = document.querySelector("[data-testid='ai-connectors-history-search']") as HTMLInputElement;
    setInputValue(visibleSearch, "");
    await flushEffects();
    await act(async () => {
      (document.querySelector("[aria-label='Select visible history rows']") as HTMLInputElement | null)?.click();
    });
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Remove selected"))
        ?.click();
    });
    await flushEffects();
    expect(mockHideAiConnectorHistory).toHaveBeenCalledWith("revoked-1");
  });

  it("adds active-connection Permissions deep links and strong permission identity headers", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [
        buildConnection({ id: "conn-1", displayName: "Primary ChatGPT" }),
        buildConnection({
          id: "claude-active",
          provider: "self_hosted",
          vendor: "anthropic",
          clientKind: "claude_ai_connector",
          authMode: "oauth",
          displayName: "Claude.ai Browser",
          scopes: ["portfolio:mcp_read"],
        }),
      ],
      policy: buildPolicy(),
      toolCatalog: [buildToolCatalogEntry()],
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();
    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-connections']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    await act(async () => {
      Array.from(document.querySelector("[data-testid='ai-connector-conn-1']")?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent?.includes("Permissions"))
        ?.click();
    });
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connectors-tab-permissions']")?.getAttribute("aria-current")).toBe("page");
    expect(window.location.search).toContain("section=permissions");
    expect(window.location.search).toContain("client=conn-1");
    expect(document.body.textContent).toContain("Primary ChatGPT");
    expect(document.body.textContent).toContain("Claude.ai Browser");
    expect(document.body.textContent).toContain("Back to connection");
    expect(document.body.textContent).toContain("OAuth");
  });
});
