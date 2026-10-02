import { expect } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseActions } from "@vakwen/test-framework/mixins";

import { SHARED_TEST_IDS } from "../pages/constants.js";

const DEFAULT_APP_READY_TIMEOUT_MS = 20_000;
const LOAD_EVENT_PROBE_TIMEOUT_MS = 2_000;

/**
 * App-specific BaseActions with shell/app readiness checks tied to
 * this application's test IDs. All Actions assistants in test-e2e
 * should extend this instead of the generic BaseActions.
 */
export class AppBaseActions extends BaseActions {
  @Step("Wait For Shell Client Ready")
  override async mxWaitForShellClientReady(timeoutMs = DEFAULT_APP_READY_TIMEOUT_MS): Promise<void> {
    await this.page.waitForLoadState("domcontentloaded");
    // App-specific readiness is driven by explicit shell markers. Cap the "load"
    // probe so slow route resources do not consume the whole test timeout budget.
    await this.page.waitForLoadState("load", { timeout: Math.min(timeoutMs, LOAD_EVENT_PROBE_TIMEOUT_MS) }).catch(() => {});
    // Streaming reloads can briefly retain both shell trees. Wait for a unique
    // marker; persistent duplicates must still fail readiness.
    await expect(this.page.getByTestId("app-shell-ready")).toHaveCount(1, { timeout: timeoutMs });
    await expect(this.page.getByTestId("app-shell-client-ready")).toHaveCount(1, { timeout: timeoutMs });

    const globalError = this.page.getByTestId(SHARED_TEST_IDS.globalErrorBanner);
    if (await globalError.isVisible().catch(() => false)) {
      throw new Error(`App failed to become ready: ${(await globalError.textContent())?.trim() ?? "unknown error"}`);
    }
  }

  @Step("Wait For App Ready")
  override async mxWaitForAppReady(timeoutMs = DEFAULT_APP_READY_TIMEOUT_MS): Promise<void> {
    await this.mxWaitForShellClientReady(timeoutMs);
    // Phase 3c: topbar-title H1 retired. Breadcrumb root is the new shell-ready
    // visual marker — it is rendered by TopBar once the AppShell is fully hydrated.
    await expect(this.page.getByTestId("breadcrumb-root")).toBeVisible({ timeout: timeoutMs });
  }
}
