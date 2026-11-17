import type { APIResponse } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { ApiBaseActions, headersForCookie } from "../../mixins/index.js";
import type { CapitalReductionsEndpoint } from "../../endpoints/CapitalReductionsEndpoint.js";
export class CapitalReductionsApiActions extends ApiBaseActions {
  declare protected readonly _instance: CapitalReductionsEndpoint;
  @Step() async list(): Promise<APIResponse> { return this._instance.list(this.authHeaders); }
  @Step() async preview(data: unknown): Promise<APIResponse> { return this._instance.preview(data, this.authHeaders); }
  @Step() async confirm(data: unknown): Promise<APIResponse> { return this._instance.confirm(data, this.authHeaders); }
  @Step() async previewForCookie(data: unknown, cookie: string): Promise<APIResponse> { return this._instance.preview(data, headersForCookie(cookie)); }
  @Step() async confirmForCookie(data: unknown, cookie: string): Promise<APIResponse> { return this._instance.confirm(data, headersForCookie(cookie)); }
  @Step() async previewAnnouncement(data: unknown): Promise<APIResponse> { return this._instance.previewAnnouncement(data, this.authHeaders); }
  @Step() async confirmAnnouncement(data: unknown): Promise<APIResponse> { return this._instance.confirmAnnouncement(data, this.authHeaders); }
}
