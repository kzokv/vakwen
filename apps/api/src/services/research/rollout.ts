import { Env } from "@vakwen/config";

interface ResearchRolloutOverride {
  acquisitionEnabled?: boolean;
  mcpExposureEnabled?: boolean;
  skillExposureEnabled?: boolean;
}

let researchRolloutOverrideForTest: ResearchRolloutOverride | null = null;

export function setResearchRolloutOverrideForTest(
  override: ResearchRolloutOverride | null,
): void {
  researchRolloutOverrideForTest = override;
}

export function researchAcquisitionEnabled(): boolean {
  return researchRolloutOverrideForTest?.acquisitionEnabled ?? Env.MCP_RESEARCH_ACQUISITION_ENABLED ?? false;
}

export function researchMcpExposureEnabled(): boolean {
  return researchRolloutOverrideForTest?.mcpExposureEnabled ?? Env.MCP_RESEARCH_MCP_ENABLED ?? false;
}

export function researchSkillExposureEnabled(): boolean {
  return researchRolloutOverrideForTest?.skillExposureEnabled ?? Env.MCP_RESEARCH_SKILL_ENABLED ?? false;
}

export function researchScopeAcquisitionAllowed(): boolean {
  return researchAcquisitionEnabled() && researchMcpExposureEnabled();
}
