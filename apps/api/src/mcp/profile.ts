import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { McpAuthContext } from "./types.js";
import { routeError } from "../lib/routeError.js";

export async function getConnectedProfile(app: FastifyInstance, auth: McpAuthContext) {
  const user = await app.persistence.getAuthUserById(auth.sessionUserId);
  if (!user || user.deactivatedAt || user.deletedAt) {
    throw routeError(401, "mcp_auth_invalid_user", "Connected Profile is unavailable");
  }
  // Internal user IDs are immutable and never reassigned. A fixed namespace keeps
  // this public identifier independent of signing-key rotation and display data.
  const id = `prf_${createHash("sha256").update(`vakwen:connected-profile:v1:${user.userId}`).digest("hex")}`;
  return { id, ...(user.displayName ? { name: user.displayName } : {}) };
}
