import { expect, type Page, type ElementHandle } from "@playwright/test";
import { mockAiConnectorApi } from "./aiConnectorsMock";

/** Browser contract fixtures: these never claim to validate OAuth persistence. */
export async function mockConsent(page: Page, client: "chatgpt" | "claude", atCapacity = false) {
  const name = client === "chatgpt" ? "ChatGPT" : "Claude.ai";
  const submitted: Record<string, unknown>[] = [];
  let denied = 0;
  let stale = false;
  const candidate = (id: string) => ({
    id, displayName: `${name} ${id}`, status: "active", scopes: ["portfolio:mcp_read"],
    createdAt: new Date(Date.now() - 86400000).toISOString(), lastUsedAt: null,
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  });
  await page.route("**/oauth/consent/qa-reauthorization**", async route => {
    const url = route.request().url();
    if (url.endsWith("/approve")) {
      submitted.push(route.request().postDataJSON());
      await route.fulfill({ status: stale ? 409 : 200, json: stale
        ? { error: "mcp_oauth_replacement_invalid", message: "Replacement target is no longer active" }
        : { redirectUrl: "/connectors/chatgpt/authorize?requestId=qa-reauthorization&approved=1" } });
    } else if (url.endsWith("/deny")) {
      denied++;
      await route.fulfill({ json: { redirectUrl: "/connectors/chatgpt/authorize?requestId=qa-reauthorization&denied=1" } });
    } else {
      await route.fulfill({ json: {
        requestId: "qa-reauthorization", clientId: client, clientKind: client === "chatgpt" ? "chatgpt_app" : "claude_ai_connector",
        clientLabel: name, vendor: client === "chatgpt" ? "openai" : "anthropic", redirectUri: "https://example.test/callback",
        resource: "https://api.example.test/mcp", scopes: ["portfolio:mcp_read"], csrfToken: "fixture-csrf",
        expiresAt: new Date(Date.now() + 600000).toISOString(), activeConnectionCount: atCapacity ? 3 : 2,
        maxActiveConnectionsPerUser: 3, replacementCandidates: [candidate("connection-a"), candidate("connection-b")],
        policy: { maxConnectorLifetimeDays: 90, postedTransactionMutationBatchLimit: 10, groupToggles: { read: true, drafts: true, write: true } },
      } });
    }
  });
  return { submitted, denied: () => denied, makeStale: () => { stale = true; } };
}

export async function assertNoOverflow(page: Page) {
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    await expect.poll(async () => {
      const bounds = await dialog.boundingBox();
      return bounds ? bounds.x + bounds.width - (page.viewportSize()?.width ?? 0) : Infinity;
    }).toBeLessThanOrEqual(1);
  }
}

export async function mockIndependentSettings(page: Page) {
  const fixture = await mockAiConnectorApi(page);
  let connections = [fixture.activeConnections[0]!, { ...fixture.activeConnections[0]!, id: "conn-chatgpt-second", displayName: "ChatGPT Research" }];
  const mutations: { id: string; body: unknown; method: string }[] = [];
  let summaryReads = 0;
  await page.route("**/ai/connectors/summary", route => {
    summaryReads++;
    return route.fulfill({ json: { connections, policy: fixture.policy, toolCatalog: [] } });
  });
  await page.route(/\/ai\/connectors\/conn-chatgpt-(active|second)(\/revoke)?$/, async route => {
    const id = route.request().url().split("/").filter(Boolean).find(part => part.startsWith("conn-chatgpt-"))!;
    const body = route.request().postDataJSON() as { displayName?: string } | null;
    const revoking = route.request().method() === "DELETE";
    mutations.push({ id, body, method: route.request().method() });
    const selected = connections.find(connection => connection.id === id)!;
    const updated = { ...selected, ...(revoking ? { status: "revoked" } : { displayName: body!.displayName! }) };
    connections = revoking ? connections.filter(connection => connection.id !== id) : connections.map(connection => connection.id === id ? updated : connection);
    await route.fulfill({ json: updated });
  });
  return { mutations, summaryReads: () => summaryReads };
}

export class ReauthorizationAssert {
  constructor(private readonly page: Page) {}
  async createDisabled(name: string) { await expect(this.page.getByRole("radio", { name })).toBeDisabled(); }
  async approvalDisabled() { await expect(this.page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled(); }
  async targetUnselected(id: string) { await expect(this.page.getByRole("radio", { name: new RegExp(id) })).not.toBeChecked(); }
  async textVisible(text: RegExp) { await expect(this.page.getByText(text).first()).toBeVisible(); }
  async staleTargetError() { await expect(this.page.getByRole("alert").filter({ hasText: "no longer eligible" })).toBeVisible(); }
  async nameDraft(value: string) { await expect(this.page.getByLabel("Connection name (optional)")).toHaveValue(value); }
  async submittedAction(submitted: Record<string, unknown>[], expected: Record<string, unknown>) {
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]).toMatchObject(expected);
    if (expected.connectionAction === "create") expect(submitted[0]).not.toHaveProperty("replacementConnectionId");
  }
  async deniedOnly(fixture: { denied: () => number; submitted: unknown[] }) {
    await expect.poll(fixture.denied).toBe(1);
    expect(fixture.submitted).toHaveLength(0);
  }
  async refreshed(reads: () => number, previous: number) { await expect.poll(reads).toBeGreaterThan(previous); }
  async inputMounted(input: ElementHandle<SVGElement | HTMLElement>) { expect(await input.evaluate(node => node.isConnected)).toBe(true); }
  async sameDocument(timeOrigin: number) { expect(await this.page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin); }
  async renameDraft(value: string) { await expect(this.page.getByTestId("ai-connector-conn-chatgpt-second").getByLabel("Connection name", { exact: true })).toHaveValue(value); }
  async renamed(value: string) { await expect(this.page.getByTestId("ai-connector-conn-chatgpt-second").getByRole("heading", { name: value })).toBeVisible(); }
  async unrelatedVisible() { await expect(this.page.getByTestId("ai-connector-conn-chatgpt-active")).toBeVisible(); }
  async selectedGone() { await expect(this.page.getByTestId("ai-connector-conn-chatgpt-second")).toHaveCount(0); }
  mutationEquals(mutation: unknown, expected: Record<string, unknown>) { expect(mutation).toMatchObject(expected); }
  async historyFilterPreserved() {
    await expect(this.page.getByTestId("ai-connectors-history-search")).toHaveValue("Claude");
    await expect(this.page.getByTestId("ai-connectors-history")).toContainText("Claude.ai Old");
  }
  async detailsVisible() { await expect(this.page.getByRole("dialog")).toContainText("ChatGPT Research"); }
  async detailsClosed() { await expect(this.page.getByRole("dialog")).toHaveCount(0); }
}

export async function navigateConsent(page: Page) {
  await page.goto("/connectors/chatgpt/authorize?requestId=qa-reauthorization");
  await expect(page.getByRole("radio").first()).toBeVisible();
}
