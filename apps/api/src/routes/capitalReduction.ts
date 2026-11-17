import { Env } from "@vakwen/config";
import { MemoryPersistence } from "../persistence/memory.js";
import { armCapitalReductionGenerationFailure } from "../services/capitalReductionGenerationControl.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveUserId } from "./registerRoutes.js";
import { routeError } from "../lib/routeError.js";
import { capitalReductionConfirmSchema, capitalReductionInputSchema, capitalReductionAnnouncementInputSchema } from "../validation/capitalReduction.js";
import { regenerateCapitalReductionAnnouncement, retryCapitalReductionAnnouncementGeneration, confirmCapitalReductionAnnouncement, previewCapitalReductionAnnouncement, confirmCapitalReduction, listCapitalReductions, previewCapitalReduction, retryCapitalReductionGeneration, type CapitalReductionContext } from "../services/capitalReduction.js";

export function capitalReductionRequestContext(app: FastifyInstance, req: FastifyRequest, write: boolean): CapitalReductionContext {
  const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
  return {
    ownerUserId: identity.userId, actorId: identity.sessionUserId,
    publish: async (change) => {
      await app.eventBus.publishEvent(identity.userId,"capital_reduction_changed",change);
      if (change.kind==="action" && change.generationStatus==="current") await app.eventBus.publishEvent(identity.userId,"currency_wallet_recomputed",{accountId:change.accountId,reason:"capital_reduction"});
    },
    authorize: async () => {
      if (identity.isImpersonating && write) throw routeError(403, "impersonation_write_blocked", "Writes are disabled while impersonating");
      const user = await app.persistence.getAuthUserById(identity.sessionUserId);
      if (user?.deactivatedAt || user?.deletedAt) throw routeError(403, "user_disabled", "Account access is disabled");
      if (identity.isSharedContext) {
        if (!await app.persistence.validateActiveShare(identity.userId, identity.sessionUserId)) throw routeError(403, "share_revoked", "Portfolio access changed");
        const shares = await app.persistence.listSharesForOwner(identity.userId);
        const share = shares.active.find((row) => row.granteeUserId === identity.sessionUserId);
        const capabilities = share ? await app.persistence.getShareCapabilities(share.id) : [];
        if (write && !capabilities.includes("transaction:write")) throw routeError(403, "shared_capability_required", "Transaction write capability required");
        return JSON.stringify({ shareId: share?.id, capabilities });
      }
      const role = user?.role ?? identity.role;
      if (write && role !== "admin" && role !== "member") throw routeError(403, "writer_role_required", "Writer role required");
      return JSON.stringify({ actor: identity.sessionUserId, owner: identity.userId, role });
    },
  };
}
export function registerCapitalReductionRoutes(app: FastifyInstance): void {
  if ((Env.NODE_ENV === "development" || Env.NODE_ENV === "test") && Env.AUTH_MODE === "dev_bypass" && app.persistence instanceof MemoryPersistence) {
    app.post("/__e2e/capital-reductions/:actionId/fail-next-generation", async (req) => {
      const { actionId } = z.object({ actionId: z.string().min(1) }).parse(req.params);
      const context = capitalReductionRequestContext(app,req,true);
      await context.authorize();
      const store = await app.persistence.loadStore(context.ownerUserId);
      const action = store.accounting.facts.capitalReductions?.actions.find((row) => row.id === actionId && store.accounts.some((account) => account.id === row.accountId));
      if (!action) throw routeError(404,"capital_reduction_not_found","Action not found");
      armCapitalReductionGenerationFailure(context.ownerUserId,action.id);
      return { armed: true, actionId: action.id, revision: action.revision };
    });
  }
  app.get("/portfolio/capital-reductions", async (req) => {
    const query = z.object({ accountId: z.string().optional(), ticker: z.string().optional() }).parse(req.query);
    return listCapitalReductions(app.persistence, capitalReductionRequestContext(app, req, false), query.accountId, query.ticker);
  });
  app.post("/portfolio/capital-reductions/announcements/preview", async (req) => previewCapitalReductionAnnouncement(app.persistence, capitalReductionRequestContext(app, req, true), capitalReductionAnnouncementInputSchema.parse(req.body)));
  app.post("/portfolio/capital-reductions/announcements/confirm", async (req) => {
    const context = capitalReductionRequestContext(app,req,true);
    const announcement = await confirmCapitalReductionAnnouncement(app.persistence,context,capitalReductionConfirmSchema.parse(req.body));
    setImmediate(() => { void regenerateCapitalReductionAnnouncement(app.persistence,context,announcement).catch((error:unknown) => app.log.error({error},"announcement regeneration failed")); });
    return announcement;
  });
  app.post("/portfolio/capital-reductions/announcements/retry-generation", async (req) => {
    const input = z.object({accountId:z.string().min(1),eventId:z.string().min(1),version:z.number().int().positive()}).strict().parse(req.body);
    return retryCapitalReductionAnnouncementGeneration(app.persistence,capitalReductionRequestContext(app,req,true),input.accountId,input.eventId,input.version);
  });
  app.post("/portfolio/capital-reductions/preview", async (req) => previewCapitalReduction(app.persistence, capitalReductionRequestContext(app, req, true), capitalReductionInputSchema.parse(req.body)));
  app.post("/portfolio/capital-reductions/confirm", async (req) => {
    const context = capitalReductionRequestContext(app, req, true);
    const action = await confirmCapitalReduction(app.persistence, context, capitalReductionConfirmSchema.parse(req.body));
    // Durable stale status precedes asynchronous generation; failures remain visible and retryable.
    if (action.generation.status === "stale") setImmediate(() => { void retryCapitalReductionGeneration(app.persistence, context, action.id).catch((error: unknown) => app.log.error({ error }, "capital reduction regeneration failed")); });
    return action;
  });
  app.post("/portfolio/capital-reductions/:actionId/retry-generation", async (req) => {
    const { actionId } = z.object({ actionId: z.string().min(1) }).parse(req.params);
    return retryCapitalReductionGeneration(app.persistence, capitalReductionRequestContext(app, req, true), actionId);
  });
}
