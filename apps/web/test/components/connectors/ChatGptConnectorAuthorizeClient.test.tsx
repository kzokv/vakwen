import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { McpOAuthConsentRequestDto } from "@vakwen/shared-types";

const mockFetchMcpOAuthConsent = vi.fn();
const mockApproveMcpOAuthConsent = vi.fn();
const mockDenyMcpOAuthConsent = vi.fn();

vi.mock("../../../features/ai-inbox/service", () => ({
  fetchMcpOAuthConsent: (...args: unknown[]) => mockFetchMcpOAuthConsent(...args),
  approveMcpOAuthConsent: (...args: unknown[]) => mockApproveMcpOAuthConsent(...args),
  denyMcpOAuthConsent: (...args: unknown[]) => mockDenyMcpOAuthConsent(...args),
}));

import { ChatGptConnectorAuthorizeClient } from "../../../components/connectors/ChatGptConnectorAuthorizeClient";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildConsent(overrides: Partial<McpOAuthConsentRequestDto> = {}): McpOAuthConsentRequestDto {
  return {
    requestId: "req-1",
    clientId: "chatgpt",
    redirectUri: "http://localhost:5555/callback",
    resource: "http://localhost:4000/mcp",
    scopes: ["portfolio:mcp_read", "transaction_draft:create"],
    csrfToken: "csrf-1",
    expiresAt: "2026-05-23T12:00:00.000Z",
    policy: {
      maxConnectorLifetimeDays: 90,
      postedTransactionMutationBatchLimit: 50,
      groupToggles: { read: true, research: false, drafts: true, write: true },
    },
    ...overrides,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`button not found: ${text}`);
  return button as HTMLButtonElement;
}

describe("ChatGptConnectorAuthorizeClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockFetchMcpOAuthConsent.mockReset();
    mockApproveMcpOAuthConsent.mockReset();
    mockDenyMcpOAuthConsent.mockReset();
    window.history.pushState(null, "", "/connectors/chatgpt/authorize?requestId=req-1");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders resource and redirect URI as fully inspectable values", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      redirectUri: "http://localhost:5555/callback/path?state=inspect",
      resource: "http://localhost:4000/mcp",
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    expect(document.body.textContent).toContain("http://localhost:4000/mcp");
    expect(document.body.textContent).toContain("http://localhost:5555/callback/path?state=inspect");
    const redirectLink = document.querySelector("a[href='http://localhost:5555/callback/path?state=inspect']");
    expect(redirectLink).not.toBeNull();
    expect(redirectLink?.className).toContain("break-all");
  });

  it("keeps consent copy generic and detects Claude.ai from the callback identity", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      clientId: "https://claude.ai/mcp/client.json",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      resource: "https://api.example.com/mcp",
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    expect(document.body.textContent).toContain("AI connector authorization");
    expect(document.body.textContent).not.toContain("Connect ChatGPT");
    expect(document.body.textContent).toContain("Detected client");
    expect(document.body.textContent).toContain("Claude.ai");
    expect(document.body.textContent).toContain("MCP resource");
    expect(document.body.textContent).toContain("Permission groups");
  });

  it("uses the server-provided OAuth client identity before URL heuristics", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      clientId: "https://metadata.example.com/oauth/client.json",
      clientKind: "claude_ai_connector",
      clientLabel: "Claude.ai",
      redirectUri: "https://metadata.example.com/oauth/callback",
      resource: "https://api.example.com/mcp",
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    expect(document.body.textContent).toContain("Detected client");
    expect(document.body.textContent).toContain("Claude.ai");
    expect(document.body.textContent).not.toContain("Generic MCP");
  });

  it("explains policy-blocked approvals while keeping denial available", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      policy: {
        maxConnectorLifetimeDays: 90,
        postedTransactionMutationBatchLimit: 50,
        groupToggles: { read: false, research: false, drafts: false, write: false },
      },
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    const alert = document.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("Admin policy has disabled every requested MCP tool group");
    expect(buttonByText("Approve").disabled).toBe(true);
    expect(buttonByText("Deny").disabled).toBe(false);
  });

  it("offers safe recovery actions when an authorization request cannot be loaded", async () => {
    mockFetchMcpOAuthConsent
      .mockRejectedValueOnce(new Error("OAuth consent request is no longer pending"))
      .mockResolvedValueOnce(buildConsent());

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    expect(document.querySelector("[role='alert']")?.textContent).toContain("OAuth consent request is no longer pending");
    expect(document.body.textContent).not.toContain("Start again in your AI client");

    await act(async () => {
      buttonByText("Retry request").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockFetchMcpOAuthConsent).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("http://localhost:4000/mcp");
  });

  it("shows callback repair guidance for Claude.ai allowlist failures", async () => {
    window.history.pushState(
      null,
      "",
      "/connectors/chatgpt/authorize?requestId=req-1&client_id=https%3A%2F%2Fclaude.ai%2Fmcp%2Fclient.json&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback",
    );
    mockFetchMcpOAuthConsent.mockRejectedValueOnce(new Error("OAuth redirect_uri is not allowed"));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    expect(document.body.textContent).toContain("This callback is not allowlisted yet");
    expect(document.body.textContent).toContain("Claude.ai");
    expect(document.body.textContent).toContain("Admin MCP settings");
    expect(document.body.textContent).toContain("Redirect callbacks");
    expect(document.body.textContent).toContain("https://claude.ai/api/mcp/auth_callback");
  });

  it("keeps transaction:write unchecked until the user explicitly opts into advanced posting", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      scopes: ["portfolio:mcp_read", "transaction_draft:create", "transaction:write"],
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    const postingLabel = Array.from(document.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.includes("Post, update, and delete confirmed transactions"));
    const postingCheckbox = postingLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    expect(postingCheckbox?.checked).toBe(false);
    expect(document.body.textContent).toContain("Advanced scope. Off by default");
    expect(document.body.textContent).toContain("preview, post, update, or delete confirmed transactions");
  });

  it("keeps dividend:write unchecked and warns as an advanced financial write scope", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      scopes: ["portfolio:mcp_read", "dividend:write"],
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    const dividendLabel = Array.from(document.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.includes("Write dividends and related portfolio accounting adjustments"));
    const dividendCheckbox = dividendLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    expect(dividendCheckbox?.checked).toBe(false);
    expect(document.body.textContent).toContain("Advanced scope. Off by default");
    expect(document.body.textContent).toContain("preview, post, update, or delete confirmed transactions and dividend actions");
  });

  it("keeps research:read unchecked and groups it separately when policy exposes research", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue({
      ...buildConsent({
        scopes: ["portfolio:mcp_read", "research:read" as never],
      }),
      policy: {
        ...buildConsent().policy,
        groupToggles: { ...buildConsent().policy.groupToggles, research: true },
      },
    });

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    const researchLabel = Array.from(document.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.includes("Research identities for Taiwan additive workflows"));
    const researchCheckbox = researchLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    expect(document.body.textContent).toContain("Research");
    expect(researchCheckbox?.checked).toBe(false);
    expect(researchLabel?.textContent).toContain("Research access is additive");
    expect(document.body.textContent).toContain("Existing OAuth connectors keep their current scopes");
  });

  it("keeps research:read disabled when policy does not expose the research group", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      scopes: ["research:read" as never],
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    const researchLabel = Array.from(document.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.includes("Research identities for Taiwan additive workflows"));
    const researchCheckbox = researchLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    expect(researchCheckbox?.disabled).toBe(true);
    expect(researchLabel?.textContent).toContain("Disabled by admin policy");
  });

  it("shows account management consent as a standard checked scope", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      scopes: ["portfolio:mcp_read", "account:manage", "transaction_draft:create"],
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    const accountLabel = Array.from(document.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.includes("Manage accounts"));
    const accountCheckbox = accountLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    expect(accountCheckbox?.checked).toBe(true);
    expect(accountCheckbox?.disabled).toBe(false);
  });

  it("renders zh-TW connector labels and scope copy when locale is explicit", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      scopes: ["portfolio:mcp_read", "account:manage", "transaction:write", "dividend:write"],
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient locale="zh-TW" />));
    await flushEffects();

    expect(document.body.textContent).toContain("AI 連接器授權");
    expect(document.body.textContent).toContain("ChatGPT / OpenAI Apps");
    expect(document.body.textContent).toContain("管理帳戶");
    expect(document.body.textContent).toContain("送出、更新與刪除已確認交易");
    expect(document.body.textContent).toContain("寫入股利與相關投資組合帳務調整");
  });
});
