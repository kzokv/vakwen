import type { Persistence } from "../../persistence/types.js";
import {
  IDENTITY_ONLY_SCOPE_STATEMENT,
  researchIdentityOnlyReportSchema,
  type ResearchIdentityOnlyReport,
  type ResearchQuery,
} from "./contracts.js";
import { getResearchIdentity } from "./service.js";

function presentFactValue(
  facts: Awaited<ReturnType<typeof getResearchIdentity>>["identity"]["facts"],
  field: string,
): string | null {
  const normalized = facts.find((fact) => fact.field === field)?.normalized;
  return normalized?.state === "present" ? normalized.value : null;
}

export async function buildIdentityOnlyResearchReport(
  persistence: Persistence,
  query: ResearchQuery,
) {
  const result = await getResearchIdentity(persistence, {
    ...query,
    history: { limit: 100 },
  });
  return researchIdentityOnlyReportSchema.parse({
    contractVersion: "research-report/1.0.0" as const,
    profile: "identity_only" as const,
    selector: result.selector,
    context: result.context,
    generatedAt: result.context.knowledgeAt,
    sections: [
      {
        id: "identity" as const,
        issuer: result.identity.issuer,
        security: result.identity.security,
        listing: result.identity.listing,
        legalName: presentFactValue(result.identity.facts, "legal_name"),
        displayName: presentFactValue(result.identity.facts, "display_name"),
        industryCode: presentFactValue(result.identity.facts, "industry_code"),
      },
      {
        id: "eligibility" as const,
        ...result.identity.eligibility,
      },
      {
        id: "unsupported_scope" as const,
        reasonCode: "identity_only_release" as const,
        statement: IDENTITY_ONLY_SCOPE_STATEMENT,
      },
    ] as const,
    evidence: {
      observationIds: result.identity.facts.map((fact) => fact.id),
      provenanceIds: [...new Set(result.identity.provenance.map((item) => item.id))],
    },
  });
}

export type IdentityOnlyResearchReport = ResearchIdentityOnlyReport;

function markdownValue(value: string | null): string {
  return value === null ? "Not reported" : value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderIdentityOnlyResearchReportMarkdown(input: IdentityOnlyResearchReport): string {
  const report = researchIdentityOnlyReportSchema.parse(input);
  const [identity, eligibility, unsupported] = report.sections;
  return [
    `# Taiwan Identity Research: ${markdownValue(identity.displayName)}`,
    "",
    `- Listing: ${identity.listing.venue}:${identity.listing.ticker}`,
    `- Listing ID: ${identity.listing.id}`,
    `- Legal name: ${markdownValue(identity.legalName)}`,
    `- Security type: ${identity.security.type}`,
    `- Industry code: ${markdownValue(identity.industryCode)}`,
    `- Eligibility: ${eligibility.state} (${eligibility.profile}; ${eligibility.reasonCode})`,
    `- Effective at: ${report.context.effectiveAt}`,
    `- Knowledge at: ${report.context.knowledgeAt}`,
    "",
    "## Scope",
    "",
    unsupported.statement,
    "",
    "## Provenance",
    "",
    ...report.evidence.provenanceIds.map((id) => `- ${id}`),
  ].join("\n");
}
