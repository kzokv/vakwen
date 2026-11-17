import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseAssert } from "../../mixins/index.js";
import type { CapitalReductionsEndpoint } from "../../endpoints/CapitalReductionsEndpoint.js";
export class CapitalReductionsApiAssert extends ApiBaseAssert {
  declare protected readonly _instance: CapitalReductionsEndpoint;
  @Step() async statusIs(response: APIResponse, expected: number): Promise<void> { await this.mxAssertResponseStatus(response, expected); }
  @Step() async fieldEquals(body: Record<string, unknown>, field: string, expected: unknown): Promise<void> { await this.mxAssertEqual(body[field], expected, `capital reduction.${field}`); }
}
