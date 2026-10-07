import type { ResearchDisclosureArtifact, ResearchDisclosureScan } from "./disclosureContracts.js";
import { disclosureId } from "./providers/mopsAnnouncements.js";

export type ArtifactRevalidation = "not_applicable" | "current" | "artifact_current_revalidation_missing" | "artifact_current_revalidation_failed" | "artifact_current_revalidation_stale";
/** Immutable source facts remain readable; current interpretations need affirmative locator refresh evidence. */
export function assessArtifactRevalidation(
  artifact: Pick<ResearchDisclosureArtifact, "id" | "reference" | "sourceUrl">,
  scan: ResearchDisclosureScan | null | undefined,
  context: { effectiveAt: string; knowledgeAt: string },
): ArtifactRevalidation {
  if (artifact.reference.kind === "announcement_attachment" && artifact.id === disclosureId("art", artifact.reference.id, "explanation")) return "not_applicable";
  if (!scan || scan.status !== "success") return "artifact_current_revalidation_missing";
  const effectiveAt = Date.parse(context.effectiveAt), knowledgeAt = Date.parse(context.knowledgeAt);
  const checkedAt = Date.parse(scan.checkedAt), completedAt = Date.parse(scan.knowledgeAt);
  if (checkedAt > effectiveAt || completedAt > knowledgeAt || Date.parse(scan.provenance.processedAt) > knowledgeAt
    || Date.parse(scan.provenance.retrievedAt) > knowledgeAt || effectiveAt - checkedAt > 30 * 60_000) return "artifact_current_revalidation_stale";
  const attempts = (scan.artifactAttempts ?? []).filter((attempt) => attempt.artifactId === artifact.id && attempt.sourceUrl === artifact.sourceUrl
    && Date.parse(attempt.attemptedAt) >= checkedAt && Date.parse(attempt.attemptedAt) <= completedAt
    && Date.parse(attempt.attemptedAt) <= effectiveAt && Date.parse(attempt.attemptedAt) <= knowledgeAt)
    .sort((a, b) => Date.parse(b.attemptedAt) - Date.parse(a.attemptedAt));
  if (!attempts.length) return "artifact_current_revalidation_missing";
  return attempts[0]!.status === "retained" ? "current" : "artifact_current_revalidation_failed";
}
