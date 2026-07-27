import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import {
  createTransactionDraftBatch,
  getTransactionDraftBatch,
  postTransactionDraftRows,
  preflightTransactionDraftCandidates,
} from "../../src/services/mcpDrafts.js";
import {
  createAccount as createMcpAccount,
  getAccountManagerComponent,
  updateAccount as updateMcpAccount,
} from "../../src/services/mcpAccounts.js";
import { BACKFILL_QUEUE, getBackfillSingletonKey } from "../../src/services/market-data/backfillWorker.js";
import type { McpRequestContext } from "../../src/mcp/types.js";

let app: Awaited<ReturnType<typeof buildApp>>;

function createRequestContext(): McpRequestContext {
  return {
    auth: {
      token: "vakwen-dev.test",
      clientId: "vakwen-dev-client",
      sessionUserId: "user-1",
      connection: null,
      scopes: [
        "portfolio:mcp_read",
        "transaction_draft:create",
        "transaction_draft:edit",
        "transaction_draft:archive",
        "transaction_draft:delete",
      ],
      toolToggles: {},
      expiresAt: null,
      authMode: "dev_token",
    },
    resolvedContext: {
      sessionUserId: "user-1",
      portfolioContextUserId: "user-1",
      shareId: null,
      shareCapabilities: [],
    },
    requestId: "test-request",
    sourceIp: "127.0.0.1",
    userAgent: "vitest",
    logger: app.log,
  };
}

describe("mcp draft services", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", seedMemoryCatalog: true });
    await app.persistence.ensureDevBypassUser();
  });

  afterEach(async () => {
    await app.close();
  });

  it("preflights trade rows and preserves unsupported rows as audit-only items", async () => {
    const result = await preflightTransactionDraftCandidates(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 2,
            unitPrice: 100,
            tradeDate: "2026-01-02",
          },
          {
            rowNumber: 2,
            recordType: "unsupported",
            sourceSnippet: "cash transfer row",
          },
        ],
      },
    );

    expect(result.summary.blockingRowCount).toBe(0);
    expect(result.summary.readyRowCount).toBe(1);
    expect(result.summary.unsupportedCount).toBe(1);
    expect(result.rows[0]?.state).toBe("ready");
    expect(result.unsupportedItems[0]?.category).toBe("non_trade");
  });

  it("renders account manager permissions from per-tool toggles", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const requestContext = createRequestContext();
    requestContext.auth.scopes.push("account:manage");
    requestContext.auth.toolToggles = {
      create_account: false,
      update_account: false,
      soft_delete_account: false,
      restore_account: true,
    };

    const result = await getAccountManagerComponent({ app, requestContext });

    expect(result.widget.permissions).toMatchObject({
      canCreate: false,
      canEdit: false,
      canSoftDelete: false,
      canRestore: true,
      manageScopeGranted: true,
      adminWritePolicyEnabled: true,
    });
    expect(result.widget.tools).toMatchObject({
      refresh: "get_account_manager_component",
      createAccount: null,
      updateAccount: null,
      softDeleteAccount: null,
      restoreAccount: "restore_account",
    });
  });

  it("uses bounded account persistence for MCP create and update without loading the full store", async () => {
    const loadStore = vi
      .spyOn(app.persistence, "loadStore")
      .mockRejectedValue(new Error("MCP account mutation must not load the aggregate store"));
    const saveStore = vi
      .spyOn(app.persistence, "saveStore")
      .mockRejectedValue(new Error("MCP account mutation must not save the aggregate store"));
    const deps = { app, requestContext: createRequestContext() };

    const created = await createMcpAccount(deps, {
      name: "MCP bounded account",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    const updated = await updateMcpAccount(deps, {
      accountId: created.account.id,
      name: "MCP bounded account renamed",
      accountType: "bank",
    });

    expect(updated.account).toMatchObject({
      id: created.account.id,
      name: "MCP bounded account renamed",
      accountType: "bank",
    });
    expect(loadStore).not.toHaveBeenCalled();
    expect(saveStore).not.toHaveBeenCalled();
  });

  it("blocks same-day collisions against posted transactions when ordering data is missing", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push({
      id: "posted-same-day",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 1,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-04",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: store.feeProfiles[0]!,
    });
    await app.persistence.saveStore(store);

    const result = await preflightTransactionDraftCandidates(
      { app, requestContext: createRequestContext() },
      {
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 101,
            tradeDate: "2026-01-04",
          },
        ],
      },
    );

    expect(result.summary.blockingRowCount).toBe(1);
    expect(result.rows[0]?.issues).toContainEqual(
      expect.objectContaining({ code: "same_day_collision" }),
    );
  });

  it("creates an MCP draft batch with persisted rows and unsupported items", async () => {
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        provenance: {
          sourceType: "csv",
          files: [{ fileId: "unit-test-file", sourceType: "csv", displayName: "unit-test.csv" }],
        },
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
          },
          {
            rowNumber: 2,
            recordType: "unsupported",
            sourceSnippet: "dividend row",
          },
        ],
      },
    );

    expect(created.batch.status).toBe("open");
    expect(created.batch.unsupportedCount).toBe(1);
    expect(created.deepLinkUrl).toContain(`/transactions?tab=ai-inbox&batch=${created.batch.id}`);

    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    expect(aggregate?.rows).toHaveLength(2);
    expect(aggregate?.unsupportedItems).toHaveLength(1);
    expect(aggregate?.events.map((event) => event.eventType)).toEqual(["batch_created", "preflight_run"]);
  });

  it("infers account metadata from a unique account name and preserves explicit zero fees", async () => {
    const result = await preflightTransactionDraftCandidates(
      { app, requestContext: createRequestContext() },
      {
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountName: "Main",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
            commissionAmount: 0,
            taxAmount: 0,
          },
        ],
      },
    );

    expect(result.summary.blockingRowCount).toBe(0);
    expect(result.rows[0]).toMatchObject({
      state: "ready",
      warnings: expect.arrayContaining([
        "account inferred from unique account name",
        "marketCode inferred from account",
        "priceCurrency inferred from account",
      ]),
      normalized: {
        accountId: "acc-1",
        accountNameInput: "Main",
        marketCode: "TW",
        priceCurrency: "TWD",
        commissionAmount: 0,
        taxAmount: 0,
      },
    });
  });

  it("blocks source fee rows unless commission and tax are supplied together", async () => {
    const result = await preflightTransactionDraftCandidates(
      { app, requestContext: createRequestContext() },
      {
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
            commissionAmount: 5,
          },
          {
            rowNumber: 2,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 101,
            tradeDate: "2026-01-04",
            taxAmount: 2,
          },
        ],
      },
    );

    expect(result.summary).toMatchObject({ blockingRowCount: 2, readyRowCount: 0 });
    expect(result.rows.map((row) => row.issues)).toEqual([
      expect.arrayContaining([expect.objectContaining({ code: "incomplete_fee_pair" })]),
      expect.arrayContaining([expect.objectContaining({ code: "incomplete_fee_pair" })]),
    ]);
  });

  it("blocks ambiguous account names before batch creation", async () => {
    const store = await app.persistence.loadStore("user-1");
    const duplicateFeeProfile = {
      ...store.feeProfiles[0]!,
      id: "fp-duplicate-main",
      accountId: "acc-duplicate-main",
    };
    store.feeProfiles.push(duplicateFeeProfile);
    store.accounts.push({
      ...store.accounts[0]!,
      id: "acc-duplicate-main",
      name: "Main",
      defaultCurrency: "USD",
      feeProfileId: duplicateFeeProfile.id,
    });
    await app.persistence.saveStore(store);

    const result = await preflightTransactionDraftCandidates(
      { app, requestContext: createRequestContext() },
      {
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountName: "Main",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
          },
        ],
      },
    );

    expect(result.summary.blockingRowCount).toBe(1);
    expect(result.rows[0]?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ambiguous_account" }),
      ]),
    );
  });

  it("rejects raw source payloads and overlong provenance snippets", async () => {
    await expect(preflightTransactionDraftCandidates(
      { app, requestContext: createRequestContext() },
      {
        provenance: {
          sourceType: "csv",
          files: [{
            fileId: "file-1",
            sourceType: "csv",
            snippet: "2330,1",
          }],
        },
        candidates: [{
          rowNumber: 1,
          recordType: "trade",
          accountId: "acc-1",
          type: "BUY",
          ticker: "2330",
          quantity: 1,
          unitPrice: 100,
          tradeDate: "2026-01-03",
          rawPayload: { csv: "ticker,qty\n2330,1" },
        } as never],
      } as never,
    )).rejects.toMatchObject({
      code: "mcp_raw_source_payload_forbidden",
    });
  });

  it("posts selected ready rows with version checks, idempotency, and compact result", async () => {
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        provenance: {
          sourceType: "csv",
          files: [{
            fileId: "file-1",
            sourceType: "csv",
            displayName: "import.csv",
            snippet: "2330,BUY,1,100",
          }],
        },
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
            commissionAmount: 0,
            taxAmount: 0,
            sourceMetadata: { fileId: "file-1", rowRef: "1", snippet: "2330,BUY,1,100" },
          },
          {
            rowNumber: 2,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 2,
            unitPrice: 101,
            tradeDate: "2026-01-04",
            sourceMetadata: { fileId: "file-1", rowRef: "2", snippet: "2330,BUY,2,101" },
          },
        ],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    expect(aggregate).toBeTruthy();

    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const bossSend = vi.fn().mockResolvedValue("backfill-job-1");
    app.boss = { send: bossSend } as never;

    const posted = await postTransactionDraftRows(
      { app, requestContext: createRequestContext() },
      {
        batchId: created.batch.id,
        rowIds: [aggregate!.rows[0]!.id],
        expectedBatchVersion: aggregate!.batch.version,
        expectedRowVersions: [{ rowId: aggregate!.rows[0]!.id, expectedVersion: aggregate!.rows[0]!.version }],
        idempotencyKey: "mcp-post-rows-1",
      },
    );

    expect(posted.outcome).toBe("posted");
    expect(posted.postedRowIds).toEqual([aggregate!.rows[0]!.id]);
    expect(posted.createdTransactionIds).toHaveLength(1);
    expect(posted.remainingUnresolvedRowIds).toEqual([]);
    expect(posted.batchVersion).toBeGreaterThan(aggregate!.batch.version);

    const canonicalStore = await app.persistence.loadStore("user-1");
    expect(canonicalStore.accounting.facts.tradeEvents.find(
      (trade) => trade.id === posted.createdTransactionIds[0],
    )).toMatchObject({
      commissionAmount: 0,
      taxAmount: 0,
      feesSource: "SOURCE_PROVIDED",
    });

    const updated = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    expect(updated?.rows.find((row) => row.id === aggregate!.rows[0]!.id)).toMatchObject({
      state: "confirmed",
      confirmedTradeEventId: posted.createdTransactionIds[0],
    });
    expect(updated?.events.at(-1)).toMatchObject({
      eventType: "rows_confirmed",
      metadata: expect.objectContaining({
        source: "mcp_tool",
        postedRowIds: [aggregate!.rows[0]!.id],
      }),
    });
    expect(bossSend).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      {
        ticker: "2330",
        marketCode: "TW",
        userId: "user-1",
        trigger: "first_trade",
      },
      { singletonKey: getBackfillSingletonKey("2330", "TW"), priority: 0 },
    );
  });

  it("keeps draft posting successful when first-trade backfill enqueue fails", async () => {
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        candidates: [{
          rowNumber: 1,
          recordType: "trade",
          accountId: "acc-1",
          type: "BUY",
          ticker: "2330",
          quantity: 1,
          unitPrice: 100,
          tradeDate: "2026-01-03",
        }],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const bossSend = vi.fn().mockRejectedValue(new Error("pg-boss unavailable"));
    const warnSpy = vi.spyOn(app.log, "warn").mockImplementation(() => undefined);
    app.boss = { send: bossSend } as never;

    const posted = await postTransactionDraftRows(
      { app, requestContext: createRequestContext() },
      {
        batchId: created.batch.id,
        rowIds: [aggregate!.rows[0]!.id],
        expectedBatchVersion: aggregate!.batch.version,
        expectedRowVersions: [{ rowId: aggregate!.rows[0]!.id, expectedVersion: aggregate!.rows[0]!.version }],
        idempotencyKey: "mcp-post-rows-backfill-failure",
      },
    );

    expect(posted.outcome).toBe("posted");
    expect(bossSend).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", rowCount: 1 }),
      "mcp_draft_first_trade_backfill_enqueue_failed",
    );
    const updated = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    expect(updated?.rows[0]).toMatchObject({
      state: "confirmed",
      confirmedTradeEventId: posted.createdTransactionIds[0],
    });
  });

  it("shows deleted confirmed lineage for posted draft rows", async () => {
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        candidates: [{
          rowNumber: 1,
          recordType: "trade",
          accountId: "acc-1",
          type: "BUY",
          ticker: "2330",
          quantity: 1,
          unitPrice: 100,
          tradeDate: "2026-01-03",
        }],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    const posted = await postTransactionDraftRows(
      { app, requestContext: createRequestContext() },
      {
        batchId: created.batch.id,
        rowIds: [aggregate!.rows[0]!.id],
        expectedBatchVersion: aggregate!.batch.version,
        expectedRowVersions: [{ rowId: aggregate!.rows[0]!.id, expectedVersion: aggregate!.rows[0]!.version }],
        idempotencyKey: "mcp-post-deleted-lineage",
      },
    );

    await app.persistence.savePostedTransactionMutationDeletedDraftLineage({
      tradeEventId: posted.createdTransactionIds[0]!,
      ownerUserId: "user-1",
      batchId: created.batch.id,
      rowId: aggregate!.rows[0]!.id,
      deletedAt: "2026-07-16T10:00:00.000Z",
      deletedByUserId: "user-1",
      mutationRunId: "run-1",
    });
    const confirmedAggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    await app.persistence.saveAiTransactionDraftRow({
      ...confirmedAggregate!.rows[0]!,
      confirmedTradeEventId: null,
    });

    const detail = await getTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      created.batch.id,
    );

    expect(detail.rows[0]).toMatchObject({
      state: "confirmed",
      confirmedTradeEventId: null,
      deletedPostedTransaction: {
        deletedAt: "2026-07-16T10:00:00.000Z",
        deletedByUserId: "user-1",
        mutationRunId: "run-1",
      },
    });
  });

  it("rejects duplicate row IDs before creating canonical transactions", async () => {
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        provenance: {
          sourceType: "csv",
          files: [{
            fileId: "file-1",
            sourceType: "csv",
            displayName: "import.csv",
            snippet: "2330,BUY,1,100",
          }],
        },
        candidates: [{
          rowNumber: 1,
          recordType: "trade",
          accountId: "acc-1",
          type: "BUY",
          ticker: "2330",
          quantity: 1,
          unitPrice: 100,
          tradeDate: "2026-01-03",
          sourceMetadata: { fileId: "file-1", rowRef: "1", snippet: "2330,BUY,1,100" },
        }],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    const row = aggregate!.rows[0]!;
    const before = await app.persistence.loadStore("user-1");

    await expect(postTransactionDraftRows(
      { app, requestContext: createRequestContext() },
      {
        batchId: created.batch.id,
        rowIds: [row.id, row.id],
        expectedBatchVersion: aggregate!.batch.version,
        expectedRowVersions: [{ rowId: row.id, expectedVersion: row.version }],
        idempotencyKey: "mcp-post-duplicate-row",
      },
    )).rejects.toMatchObject({
      code: "mcp_draft_duplicate_row_id",
    });

    const after = await app.persistence.loadStore("user-1");
    expect(after.accounting.facts.tradeEvents).toHaveLength(before.accounting.facts.tradeEvents.length);
    const refreshed = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    expect(refreshed?.rows[0]).toMatchObject({ state: "ready", version: row.version });
  });

  it("skips first-trade backfill enqueue for demo owners", async () => {
    await app.persistence.markDemoUser("user-1", 300);
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const bossSend = vi.fn().mockResolvedValue("backfill-job-1");
    app.boss = { send: bossSend } as never;
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
          },
        ],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);

    await postTransactionDraftRows(
      { app, requestContext: createRequestContext() },
      {
        batchId: created.batch.id,
        rowIds: [aggregate!.rows[0]!.id],
        expectedBatchVersion: aggregate!.batch.version,
        expectedRowVersions: [{ rowId: aggregate!.rows[0]!.id, expectedVersion: aggregate!.rows[0]!.version }],
        idempotencyKey: "mcp-post-rows-demo-skip",
      },
    );

    expect(bossSend).not.toHaveBeenCalled();
  });
});
