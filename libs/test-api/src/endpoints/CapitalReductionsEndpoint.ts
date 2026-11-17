import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@vakwen/test-framework/core";
import { apiUrl } from "@vakwen/test-framework/shared";

export class CapitalReductionsEndpoint extends BaseEndpoint {
  list = (headers: Record<string, string>) => this.request.get(apiUrl("/portfolio/capital-reductions"), { headers });
  preview = (data: unknown, headers: Record<string, string>): Promise<APIResponse> => this.request.post(apiUrl("/portfolio/capital-reductions/preview"), { data, headers });
  confirm = (data: unknown, headers: Record<string, string>): Promise<APIResponse> => this.request.post(apiUrl("/portfolio/capital-reductions/confirm"), { data, headers });
  previewAnnouncement = (data: unknown, headers: Record<string, string>): Promise<APIResponse> => this.request.post(apiUrl("/portfolio/capital-reductions/announcements/preview"), { data, headers });
  confirmAnnouncement = (data: unknown, headers: Record<string, string>): Promise<APIResponse> => this.request.post(apiUrl("/portfolio/capital-reductions/announcements/confirm"), { data, headers });
}
