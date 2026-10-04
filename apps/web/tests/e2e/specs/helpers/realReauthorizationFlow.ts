import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, request as createRequest, type Page, type APIRequestContext } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";

type Tokens = { access_token: string; refresh_token: string };

/** Real local API and browser consent; only the external OAuth client's callback is captured. */
export class RealReauthorizationFlow {
  private readonly headers: Record<string, string>;
  private callback = "";
  private callbackServer: Server | null = null;
  private readonly resource = `${TestEnv.apiBaseUrl}/mcp`;
  private readonly verifier = randomBytes(48).toString("base64url");
  private originalPolicy: Record<string, unknown> | null = null;
  constructor(private readonly page: Page, private readonly request: APIRequestContext, userId: string) {
    this.headers = { "x-user-id": userId };
  }
  private url(path: string) { return `${TestEnv.apiBaseUrl}${path}`; }
  async configure() {
    this.callbackServer = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<h1>Local client callback received</h1>");
    });
    await new Promise<void>(resolve => this.callbackServer!.listen(0, "127.0.0.1", resolve));
    const address = this.callbackServer.address();
    if (!address || typeof address === "string") throw new Error("Local callback did not acquire port");
    this.callback = `http://127.0.0.1:${address.port}/callback`;
    const current = await this.request.get(this.url("/admin/mcp/settings"), { headers: this.headers });
    expect(current.status()).toBe(200);
    this.originalPolicy = await current.json();
    expect(this.originalPolicy?.oauthTokenSecretSet, "isolated local suite must not replace a preexisting secret").toBe(false);
    const fresh = await this.request.post(this.url("/admin/mcp/fresh-auth"), { headers: this.headers });
    expect(fresh.status()).toBe(200);
    const result = await this.request.patch(this.url("/admin/mcp/settings"), {
      headers: { ...this.headers, "x-vakwen-fresh-auth-at": (await fresh.json()).freshAuthToken },
      data: { enabled: true, oauthPublicIssuer: TestEnv.apiBaseUrl, oauthRedirectUriAllowlist: [this.callback], mcpOauthTokenSecret: randomBytes(48).toString("base64url") },
    });
    expect(result.status()).toBe(200);
  }
  async restore() {
    this.callbackServer?.closeAllConnections();
    if (this.callbackServer) await new Promise<void>(resolve => this.callbackServer!.close(() => resolve()));
    if (!this.originalPolicy || this.originalPolicy.oauthTokenSecretSet) return;
    const cleanup = await createRequest.newContext({ timeout: 5000 });
    try {
      const fresh = await cleanup.post(this.url("/admin/mcp/fresh-auth"), { headers: this.headers });
      const result = await cleanup.patch(this.url("/admin/mcp/settings"), {
        headers: { ...this.headers, "x-vakwen-fresh-auth-at": (await fresh.json()).freshAuthToken },
        data: { enabled: this.originalPolicy.enabled, oauthPublicIssuer: this.originalPolicy.oauthPublicIssuer,
          oauthRedirectUriAllowlist: this.originalPolicy.oauthRedirectUriAllowlist, mcpOauthTokenSecret: null },
      });
      expect(result.status()).toBe(200);
    } finally { await cleanup.dispose(); }
  }
  private async begin() {
    const query = new URLSearchParams({ response_type: "code", client_id: "chatgpt", redirect_uri: this.callback,
      resource: this.resource, scope: "portfolio:mcp_read", code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(this.verifier).digest("base64url") });
    const authorize = await this.request.get(this.url(`/oauth/authorize?${query}`), { headers: this.headers, maxRedirects: 0 });
    expect(authorize.status()).toBe(302);
    const location = authorize.headers().location!;
    expect(location).toContain("requestId=");
    await this.page.goto(location);
    await expect(this.page.getByRole("radio", { name: "Create another connection" })).toBeVisible();
  }
  async authorize(label: string, replacementLabel?: string): Promise<Tokens> {
    await this.begin();
    if (replacementLabel) {
      await this.page.getByRole("radio", { name: "Replace an existing connection" }).check();
      await this.page.getByRole("radio", { name: new RegExp(replacementLabel) }).check();
    }
    await this.page.getByLabel("Connection name (optional)").fill(label);
    await this.page.getByRole("button", { name: "Approve", exact: true }).click();
    await this.page.waitForURL(`${this.callback}**`);
    const code = new URL(this.page.url()).searchParams.get("code");
    expect(code).toBeTruthy();
    const result = await this.request.post(this.url("/oauth/token"), { form: {
      grant_type: "authorization_code", client_id: "chatgpt", redirect_uri: this.callback, resource: this.resource,
      code_verifier: this.verifier, code: code!,
    } });
    expect(result.status()).toBe(200);
    return result.json();
  }
  async cancelReplacement(label: string) {
    await this.begin();
    await this.page.getByRole("radio", { name: "Replace an existing connection" }).check();
    await this.page.getByRole("radio", { name: new RegExp(label) }).check();
    await this.page.getByRole("button", { name: "Deny", exact: true }).click();
    await this.page.waitForURL(`${this.callback}**`);
    expect(new URL(this.page.url()).searchParams.get("error")).toBe("access_denied");
  }
  async read(tokens: Tokens, existingSession?: string) {
    const headers = { authorization: `Bearer ${tokens.access_token}`, accept: "application/json, text/event-stream" };
    let session = existingSession;
    if (!session) {
      const init = await this.request.post(this.url("/mcp"), { headers, data: { jsonrpc: "2.0", id: "init", method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "local-browser-acceptance", version: "1" } } } });
      expect(init.status()).toBe(200);
      session = init.headers()["mcp-session-id"]!;
    }
    const result = await this.request.post(this.url("/mcp"), { headers: { ...headers, "mcp-session-id": session }, data: {
      jsonrpc: "2.0", id: "read", method: "tools/call", params: { name: "list_portfolio_contexts", arguments: {} },
    } });
    expect(result.status()).toBe(200);
    const body = await result.text();
    const parsed = JSON.parse(body.startsWith("{") ? body : body.split("\n").find(line => line.startsWith("data: "))!.slice(6));
    expect(parsed.result.isError).not.toBe(true);
    return session;
  }
  async refresh(tokens: Tokens, succeeds = true) {
    const result = await this.request.post(this.url("/oauth/token"), { form: { grant_type: "refresh_token", client_id: "chatgpt", resource: this.resource, refresh_token: tokens.refresh_token } });
    expect(result.status()).toBe(succeeds ? 200 : 400);
    return succeeds ? result.json() as Promise<Tokens> : null;
  }
  async assertHistory() {
    const result = await this.request.get(this.url("/ai/connectors/history"), { headers: this.headers });
    expect(result.status()).toBe(200);
    const history = (await result.json()).connections as { displayName: string; replacedByConnectionId: string | null }[];
    const a = history.find(connection => connection.displayName === "Local A");
    expect(a?.replacedByConnectionId).toBeTruthy();
    expect(history.filter(connection => connection.replacedByConnectionId)).toHaveLength(1);
  }
}
