import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AiConnectorScope } from "@vakwen/shared-types";
import {
  buildMcpWwwAuthenticateHeader,
  getMcpProtectedResourceMetadataUrl,
} from "./oauth.js";
import { listMcpToolDefinitions, scopesForListedTool, type McpToolName } from "./tools.js";

interface McpOAuthSecurityScheme {
  type: "oauth2";
  scopes: string[];
}

interface JsonRpcRequestHandlerExtra {
  signal: AbortSignal;
  sessionId?: string;
  authInfo?: unknown;
  requestInfo?: unknown;
  sendNotification?: unknown;
  sendRequest?: unknown;
}

interface McpToolListResult {
  tools: Array<{
    name: string;
    title?: string;
    _meta?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
    execution?: unknown;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    securitySchemes?: McpOAuthSecurityScheme[];
  }>;
  nextCursor?: string;
}

export const OPENAI_APPS_RESOURCE_URI = "ui://widget/vakwen.html";
const OPENAI_APPS_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const OPENAI_APPS_WIDGET_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Vakwen</title>
    <style>
      :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; padding: 16px; background: transparent; color: CanvasText; }
      main { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px; padding: 16px; }
      h1 { font-size: 16px; line-height: 1.3; margin: 0 0 8px; }
      p { margin: 0 0 12px; color: color-mix(in srgb, CanvasText 72%, transparent); }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
    </style>
  </head>
  <body>
    <main>
      <h1>Vakwen</h1>
      <p>Portfolio and transaction draft data returned by Vakwen tools.</p>
      <pre id="vakwen-output">Waiting for a tool result.</pre>
    </main>
    <script>
      const output = document.getElementById("vakwen-output");
      function render(value) {
        const data = value && (value.structuredContent || value.content || value);
        output.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      }
      window.addEventListener("message", (event) => {
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (message.method === "ui/notifications/tool-result") render(message.params);
        if (message.method === "ui/notifications/tool-input") render({ input: message.params });
      }, { passive: true });
    </script>
  </body>
</html>`;

const OPENAI_APPS_SCHEMA_OMITTED_KEYS = new Set([
  "$schema",
  "default",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "multipleOf",
  "pattern",
]);
export const OPENAI_APPS_MCP_CORS_EXPOSED_HEADERS = ["mcp-session-id", "www-authenticate"] as const;
export const OPENAI_APPS_MCP_CORS_METHODS = ["GET", "HEAD", "POST", "OPTIONS"] as const;
export const OPENAI_APPS_MCP_CORS_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/mcp",
  "/.well-known/openid-configuration",
  "/.well-known/openid-configuration/mcp",
  "/mcp",
  "/oauth/token",
]);
const OPENAI_APPS_MCP_CORS_ORIGINS = new Set([
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://claude.ai",
]);
const DEFAULT_TOOL_META = {
  outputTemplate: OPENAI_APPS_RESOURCE_URI,
  widgetAccessible: false,
  uiResourceUri: OPENAI_APPS_RESOURCE_URI,
} as const;

export function getMcpRequestMethod(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const method = (body as { method?: unknown }).method;
  return typeof method === "string" ? method : undefined;
}

function hasBearerAuthorization(req: FastifyRequest): boolean {
  const header = req.headers.authorization;
  return typeof header === "string" && /^Bearer\s+.+/i.test(header);
}

function getMcpResourceReadUri(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const uri = (params as { uri?: unknown }).uri;
  return typeof uri === "string" ? uri : undefined;
}

export function isPublicMcpDiscoveryRequest(req: FastifyRequest): boolean {
  if (hasBearerAuthorization(req)) return false;
  const method = getMcpRequestMethod(req.body);
  if (method === "initialize" || method === "tools/list") return true;
  return method === "resources/read" && getMcpResourceReadUri(req.body) === OPENAI_APPS_RESOURCE_URI;
}

function requestOrigin(req: FastifyRequest): string | undefined {
  const origin = req.headers.origin;
  return Array.isArray(origin) ? origin[0] : origin;
}

function normalizeOrigin(origin: string): string | undefined {
  try {
    return new URL(origin).origin;
  } catch {
    return undefined;
  }
}

export function isOpenAiAppsMcpCorsOrigin(origin: string | undefined): boolean {
  const normalizedOrigin = origin ? normalizeOrigin(origin) : undefined;
  return Boolean(normalizedOrigin && OPENAI_APPS_MCP_CORS_ORIGINS.has(normalizedOrigin));
}

function appendVaryHeader(existing: number | string | string[] | undefined, value: string): string {
  const parts = (Array.isArray(existing) ? existing.join(",") : String(existing ?? ""))
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.some((part) => part.toLowerCase() === value.toLowerCase())) parts.push(value);
  return parts.join(", ");
}

export function setOpenAiAppsMcpTransportCorsHeaders(req: FastifyRequest, reply: FastifyReply): void {
  const origin = requestOrigin(req);
  if (!origin || !isOpenAiAppsMcpCorsOrigin(origin)) return;

  reply.raw.setHeader("access-control-allow-origin", origin);
  reply.raw.setHeader("access-control-expose-headers", OPENAI_APPS_MCP_CORS_EXPOSED_HEADERS.join(","));
  reply.raw.setHeader("vary", appendVaryHeader(reply.raw.getHeader("vary"), "Origin"));
}

function routeErrorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function routeErrorStatusCode(error: unknown): number | undefined {
  return error instanceof Error && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : undefined;
}

export function shouldReturnToolAuthChallenge(error: unknown): boolean {
  const code = routeErrorCode(error);
  return (
    routeErrorStatusCode(error) === 401
    || code === "mcp_scope_denied"
    || code === "mcp_connection_expired"
    || code === "mcp_connection_inactive"
  );
}

export function challengeErrorFor(error: unknown): "invalid_token" | "insufficient_scope" {
  return routeErrorCode(error) === "mcp_scope_denied" ? "insufficient_scope" : "invalid_token";
}

export function toToolTitle(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function buildToolAuthChallengeResult(input: {
  app: FastifyInstance;
  req: FastifyRequest;
  scope: AiConnectorScope;
  error: string;
  description: string;
  text: string;
}) {
  const metadataUrl = await getMcpProtectedResourceMetadataUrl(input.app, input.req);
  return {
    content: [{ type: "text" as const, text: input.text }],
    _meta: {
      "mcp/www_authenticate": [
        buildMcpWwwAuthenticateHeader(metadataUrl, {
          scope: input.scope,
          error: input.error,
          errorDescription: input.description,
        }),
      ],
    },
    isError: true,
  };
}

function getToolSecuritySchemes(toolName: McpToolName): McpOAuthSecurityScheme[] {
  const listedTool = listMcpToolDefinitions().find((tool) => tool.name === toolName);
  if (!listedTool) return [];
  return scopesForListedTool(listedTool).map((scope) => ({ type: "oauth2", scopes: [scope] }));
}

function getToolOpenAiMeta(tool: McpToolListResult["tools"][number]) {
  const outputTemplate = typeof tool._meta?.["openai/outputTemplate"] === "string"
    ? tool._meta["openai/outputTemplate"]
    : DEFAULT_TOOL_META.outputTemplate;
  const widgetAccessible = typeof tool._meta?.["openai/widgetAccessible"] === "boolean"
    ? tool._meta["openai/widgetAccessible"]
    : DEFAULT_TOOL_META.widgetAccessible;
  return {
    outputTemplate,
    widgetAccessible,
    uiResourceUri: outputTemplate,
  };
}

function withToolSecurityMetadata(tool: McpToolListResult["tools"][number]) {
  const securitySchemes = Array.isArray(tool.securitySchemes)
    ? tool.securitySchemes as McpOAuthSecurityScheme[]
    : getToolSecuritySchemes(tool.name as McpToolName);
  const openAiMeta = getToolOpenAiMeta(tool);
  const chatGptTool = { ...tool };
  delete chatGptTool.execution;
  const existingUi = isJsonRecord(tool._meta?.ui) ? tool._meta.ui : {};
  const visibility = Array.isArray(existingUi.visibility)
    ? existingUi.visibility.filter((value): value is string => typeof value === "string")
    : ["model", "app"];
  return {
    ...chatGptTool,
    title: tool.title ?? toToolTitle(tool.name),
    inputSchema: sanitizeOpenAiAppsJsonSchema(tool.inputSchema),
    outputSchema: sanitizeOpenAiAppsJsonSchema(tool.outputSchema),
    securitySchemes,
    _meta: {
      ...tool._meta,
      securitySchemes,
      ui: {
        ...existingUi,
        resourceUri: openAiMeta.uiResourceUri,
        visibility,
      },
      "openai/outputTemplate": openAiMeta.outputTemplate,
      "openai/widgetAccessible": openAiMeta.widgetAccessible,
      "openai/toolInvocation/invoking": "Running Vakwen tool",
      "openai/toolInvocation/invoked": "Vakwen result ready",
    },
  };
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveLocalJsonPointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  return ref
    .slice(2)
    .split("/")
    .map(decodeJsonPointerSegment)
    .reduce<unknown>((current, segment) => (
      isJsonRecord(current) ? current[segment] : undefined
    ), root);
}

function sanitizeOpenAiAppsJsonSchema(schema: unknown): unknown {
  return sanitizeOpenAiAppsJsonSchemaNode(schema, schema, new Set());
}

function sanitizeOpenAiAppsJsonSchemaNode(
  node: unknown,
  root: unknown,
  seenRefs: Set<string>,
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => sanitizeOpenAiAppsJsonSchemaNode(item, root, seenRefs));
  }
  if (!isJsonRecord(node)) return node;

  const ref = typeof node.$ref === "string" ? node.$ref : undefined;
  if (ref) {
    const resolved = seenRefs.has(ref) ? undefined : resolveLocalJsonPointer(root, ref);
    if (resolved !== undefined) {
      const nextSeenRefs = new Set(seenRefs);
      nextSeenRefs.add(ref);
      const sanitizedResolved = sanitizeOpenAiAppsJsonSchemaNode(resolved, root, nextSeenRefs);
      const siblingEntries = Object.entries(node).filter(([key]) => key !== "$ref");
      if (siblingEntries.length === 0) return sanitizedResolved;
      return sanitizeOpenAiAppsJsonSchemaNode(
        {
          ...(isJsonRecord(sanitizedResolved) ? sanitizedResolved : {}),
          ...Object.fromEntries(siblingEntries),
        },
        root,
        nextSeenRefs,
      );
    }
  }

  const sanitizedEntries = Object.entries(node)
    .filter(([key]) => key !== "$ref" && !OPENAI_APPS_SCHEMA_OMITTED_KEYS.has(key))
    .map(([key, value]) => [key, sanitizeOpenAiAppsJsonSchemaNode(value, root, seenRefs)] as const);
  const sanitized = Object.fromEntries(sanitizedEntries);

  if (isJsonRecord(sanitized.properties) && Array.isArray(sanitized.required)) {
    const propertyNames = new Set(Object.keys(sanitized.properties));
    sanitized.required = sanitized.required.filter((item) => typeof item === "string" && propertyNames.has(item));
  }
  return sanitized;
}

export function attachOpenAiAppsToolMetadata(server: McpServer): void {
  const rawServer = server.server as unknown as {
    _requestHandlers: Map<string, (request: unknown, extra: JsonRpcRequestHandlerExtra) => Promise<McpToolListResult>>;
  };
  const listToolsHandler = rawServer._requestHandlers.get("tools/list");
  if (!listToolsHandler) throw new Error("MCP tools/list handler is not registered");

  server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = await listToolsHandler(request, extra as JsonRpcRequestHandlerExtra);
    return {
      ...result,
      tools: result.tools.map(withToolSecurityMetadata),
    };
  });
}

export function registerOpenAiAppsResource(server: McpServer): void {
  server.registerResource(
    "vakwen_app_widget",
    OPENAI_APPS_RESOURCE_URI,
    {
      title: "Vakwen",
      description: "Renders Vakwen MCP tool results inside ChatGPT.",
      mimeType: OPENAI_APPS_RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: OPENAI_APPS_RESOURCE_URI,
          mimeType: OPENAI_APPS_RESOURCE_MIME_TYPE,
          text: OPENAI_APPS_WIDGET_HTML,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
            "openai/widgetDescription": "Displays portfolio and transaction draft data returned by Vakwen.",
            "openai/widgetPrefersBorder": true,
            "openai/widgetCSP": {
              connect_domains: [],
              resource_domains: [],
            },
          },
        },
      ],
    }),
  );
}
