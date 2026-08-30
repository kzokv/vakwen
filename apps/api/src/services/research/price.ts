import { createHash } from "node:crypto";
import type { ResearchListingVenue } from "./identity.js";

export type ResearchPriceSessionState =
  | "full_bar"
  | "close_only"
  | "no_trade"
  | "suspended";

export interface ResearchPriceProvenance {
  id: string;
  publisher: ResearchListingVenue;
  accessProvider: "TWSE_OPENAPI" | "TPEX_OPENAPI" | "TWSE_WEB_JSON" | "TPEX_WEB_JSON";
  authorityRole: "authoritative";
  canonicalDatasetId: "price_series";
  publisherDataset: string;
  sourceUrl: string;
  contentHash: string;
  acquisitionPath: "scheduled_official_snapshot";
  acquisitionRunId: string;
  retrievedAt: string;
  parserVersion: "research-price-parser/1.0.0";
  usagePolicyVersion: "taiwan-open-data/1.0.0";
  retentionStatus: "retained";
  contentExposure: "allowed";
}

export interface CanonicalPriceObservation {
  id: string;
  kind: "source_fact";
  subject: { kind: "listing"; id: string };
  field: string;
  raw:
    | { state: "present"; label: string; value: string }
    | { state: "missing"; label: string; reason: "not_reported" };
  normalized:
    | { state: "present"; value: string }
    | { state: "missing"; reason: "not_reported" | "unparseable" };
  effectiveAt: string;
  publishedAt: { state: "missing"; reason: "unknown" };
  retrievedAt: string;
  processedAt: string;
  provenanceId: string;
  contractVersion: "research-observation/1.0.0";
  normalizationVersion: "price-normalization/1.0.0";
}

export interface OfficialPriceInput {
  listingId: string;
  ticker: string;
  venue: ResearchListingVenue;
  sessionDate: string;
  retrievedAt: string;
  acquisitionRunId?: string;
  artifact: {
    contentHash: string;
    sourceUrl: string;
    publisherDataset: string;
    accessProvider: "TWSE_OPENAPI" | "TPEX_OPENAPI" | "TWSE_WEB_JSON" | "TPEX_WEB_JSON";
  };
  row: {
    state: ResearchPriceSessionState;
    open?: string;
    high?: string;
    low?: string;
    close?: string;
    volume?: string;
    tradedValue?: string;
    tradeCount?: string;
    note?: string;
    rawValues?: Partial<Record<string, string>>;
  };
}

export interface ResearchPriceRecord {
  listingId: string;
  ticker: string;
  venue: ResearchListingVenue;
  sessionDate: string;
  state: ResearchPriceSessionState;
  observations: CanonicalPriceObservation[];
  provenance: ResearchPriceProvenance;
}

export interface ResearchPriceRecordQuery {
  subject:
    | { kind: "listing_id"; listingId: string }
    | { kind: "venue"; venue: ResearchListingVenue };
  startDate: string;
  endDate: string;
  knowledgeAt: string;
}

function invalidResearchPriceRecord(message: string): Error {
  return new Error(`research_price_record_invalid: ${message}`);
}

function opaqueId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32);
  return `${prefix}_${digest}`;
}

function priceEffectiveAt(sessionDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    throw invalidResearchPriceRecord(`invalid sessionDate ${sessionDate}`);
  }
  const utcDate = new Date(`${sessionDate}T00:00:00.000Z`);
  if (Number.isNaN(utcDate.getTime()) || utcDate.toISOString().slice(0, 10) !== sessionDate) {
    throw invalidResearchPriceRecord(`invalid sessionDate ${sessionDate}`);
  }
  return new Date(`${sessionDate}T00:00:00+08:00`).toISOString();
}

function isNormalizedDecimalString(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value);
}

function normalizePublisherNumericValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().replaceAll(",", "");
  return normalized.length === 0 ? undefined : normalized;
}

function validateObservationValue(field: string, value: string | undefined): void {
  if (value === undefined) return;
  const normalized = normalizePublisherNumericValue(value);
  if (!normalized || !isNormalizedDecimalString(normalized)) {
    throw invalidResearchPriceRecord(`invalid ${field} value ${value}`);
  }
  if ((field === "open" || field === "high" || field === "low" || field === "close") && Number(normalized) <= 0) {
    throw invalidResearchPriceRecord(`invalid ${field} value ${value}`);
  }
}

function validateOfficialPriceInput(input: OfficialPriceInput): void {
  priceEffectiveAt(input.sessionDate);
  switch (input.row.state) {
    case "full_bar":
      for (const field of ["open", "high", "low", "close", "volume", "tradedValue", "tradeCount"] as const) {
        if (input.row[field] === undefined) {
          throw invalidResearchPriceRecord(`missing ${field} for full_bar`);
        }
      }
      break;
    case "close_only":
      if (input.row.close === undefined) {
        throw invalidResearchPriceRecord("missing close for close_only");
      }
      break;
    case "no_trade":
    case "suspended":
      break;
  }
  validateObservationValue("open", input.row.open);
  validateObservationValue("high", input.row.high);
  validateObservationValue("low", input.row.low);
  validateObservationValue("close", input.row.close);
  validateObservationValue("volume", input.row.volume);
  validateObservationValue("tradedValue", input.row.tradedValue);
  validateObservationValue("tradeCount", input.row.tradeCount);
}

export function validateResearchPriceRecord(record: ResearchPriceRecord): void {
  priceEffectiveAt(record.sessionDate);
  const normalizedByField = new Map(record.observations.map((observation) => [observation.field, observation.normalized] as const));
  const requirePresentDecimal = (field: string) => {
    const normalized = normalizedByField.get(field);
    if (!normalized || normalized.state !== "present" || !isNormalizedDecimalString(normalized.value)) {
      throw invalidResearchPriceRecord(`missing or invalid ${field} for ${record.state}`);
    }
  };
  const sessionState = normalizedByField.get("session_state");
  if (!sessionState || sessionState.state !== "present" || sessionState.value !== record.state) {
    throw invalidResearchPriceRecord("session_state observation mismatch");
  }
  switch (record.state) {
    case "full_bar":
      requirePresentDecimal("open");
      requirePresentDecimal("high");
      requirePresentDecimal("low");
      requirePresentDecimal("close");
      requirePresentDecimal("volume");
      requirePresentDecimal("traded_value");
      requirePresentDecimal("trade_count");
      break;
    case "close_only":
      requirePresentDecimal("close");
      break;
    case "no_trade":
      for (const field of ["close", "volume", "traded_value", "trade_count"] as const) {
        const normalized = normalizedByField.get(field);
        if (normalized?.state === "present" && !isNormalizedDecimalString(normalized.value)) {
          throw invalidResearchPriceRecord(`invalid ${field} for no_trade`);
        }
      }
      break;
    case "suspended":
      break;
  }
}

function createObservation(input: {
  listingId: string;
  field: string;
  rawLabel: string;
  rawValue?: string;
  normalizedValue?: string;
  effectiveAt: string;
  retrievedAt: string;
  provenanceId: string;
}): CanonicalPriceObservation {
  return {
    id: opaqueId(
      "price_obs",
      input.listingId,
      input.field,
      input.rawValue ?? "",
      input.normalizedValue ?? "",
      input.effectiveAt,
      input.retrievedAt,
      input.provenanceId,
    ),
    kind: "source_fact",
    subject: { kind: "listing", id: input.listingId },
    field: input.field,
    raw: input.rawValue === undefined
      ? { state: "missing", label: input.rawLabel, reason: "not_reported" }
      : { state: "present", label: input.rawLabel, value: input.rawValue },
    normalized: input.normalizedValue === undefined
      ? { state: "missing", reason: "not_reported" }
      : { state: "present", value: input.normalizedValue },
    effectiveAt: input.effectiveAt,
    publishedAt: { state: "missing", reason: "unknown" },
    retrievedAt: input.retrievedAt,
    processedAt: input.retrievedAt,
    provenanceId: input.provenanceId,
    contractVersion: "research-observation/1.0.0",
    normalizationVersion: "price-normalization/1.0.0",
  };
}

export function canonicalizeOfficialPriceRow(input: OfficialPriceInput): ResearchPriceRecord {
  validateOfficialPriceInput(input);
  const acquisitionRunId = input.acquisitionRunId ?? "manual";
  const provenanceId = opaqueId(
    "price_prov",
    input.listingId,
    input.venue,
    input.sessionDate,
    input.artifact.publisherDataset,
    input.artifact.sourceUrl,
    input.artifact.contentHash,
    input.retrievedAt,
  );
  const effectiveAt = priceEffectiveAt(input.sessionDate);
  const observations: CanonicalPriceObservation[] = [
    createObservation({
      listingId: input.listingId,
      field: "session_state",
      rawLabel: "Session state",
      rawValue: input.row.state,
      normalizedValue: input.row.state,
      effectiveAt,
      retrievedAt: input.retrievedAt,
      provenanceId,
    }),
    createObservation({
      listingId: input.listingId,
      field: "open",
      rawLabel: "Open",
      rawValue: input.row.open,
      normalizedValue: normalizePublisherNumericValue(input.row.open),
      effectiveAt,
      retrievedAt: input.retrievedAt,
      provenanceId,
    }),
    createObservation({
      listingId: input.listingId,
      field: "high",
      rawLabel: "High",
      rawValue: input.row.high,
      normalizedValue: normalizePublisherNumericValue(input.row.high),
      effectiveAt,
      retrievedAt: input.retrievedAt,
      provenanceId,
    }),
    createObservation({
      listingId: input.listingId,
      field: "low",
      rawLabel: "Low",
      rawValue: input.row.low,
      normalizedValue: normalizePublisherNumericValue(input.row.low),
      effectiveAt,
      retrievedAt: input.retrievedAt,
      provenanceId,
    }),
    createObservation({
      listingId: input.listingId,
      field: "close",
      rawLabel: "Close",
      rawValue: input.row.close,
      normalizedValue: normalizePublisherNumericValue(input.row.close),
      effectiveAt,
      retrievedAt: input.retrievedAt,
      provenanceId,
    }),
    createObservation({
      listingId: input.listingId,
      field: "volume",
      rawLabel: "Volume",
      rawValue: input.row.volume,
      normalizedValue: normalizePublisherNumericValue(input.row.volume),
      effectiveAt,
      retrievedAt: input.retrievedAt,
      provenanceId,
    }),
    createObservation({
      listingId: input.listingId,
      field: "traded_value",
      rawLabel: "Traded value",
      rawValue: input.row.tradedValue,
      normalizedValue: normalizePublisherNumericValue(input.row.tradedValue),
      effectiveAt,
      retrievedAt: input.retrievedAt,
      provenanceId,
    }),
    createObservation({
      listingId: input.listingId,
      field: "trade_count",
      rawLabel: "Trade count",
      rawValue: input.row.tradeCount,
      normalizedValue: normalizePublisherNumericValue(input.row.tradeCount),
      effectiveAt,
      retrievedAt: input.retrievedAt,
      provenanceId,
    }),
    createObservation({
      listingId: input.listingId,
      field: "note",
      rawLabel: "Note",
      rawValue: input.row.note,
      normalizedValue: input.row.note?.trim(),
      effectiveAt,
      retrievedAt: input.retrievedAt,
      provenanceId,
    }),
  ];
  return {
    listingId: input.listingId,
    ticker: input.ticker,
    venue: input.venue,
    sessionDate: input.sessionDate,
    state: input.row.state,
    observations,
    provenance: {
      id: provenanceId,
      publisher: input.venue,
      accessProvider: input.artifact.accessProvider,
      authorityRole: "authoritative",
      canonicalDatasetId: "price_series",
      publisherDataset: input.artifact.publisherDataset,
      sourceUrl: input.artifact.sourceUrl,
      contentHash: input.artifact.contentHash,
      acquisitionPath: "scheduled_official_snapshot",
      acquisitionRunId,
      retrievedAt: input.retrievedAt,
      parserVersion: "research-price-parser/1.0.0",
      usagePolicyVersion: "taiwan-open-data/1.0.0",
      retentionStatus: "retained",
      contentExposure: "allowed",
    },
  };
}

export function researchPriceRecordKey(record: ResearchPriceRecord): string {
  return `${record.listingId}:${record.sessionDate}:${record.provenance.id}`;
}

export function researchPriceRecordSortOrder(left: ResearchPriceRecord, right: ResearchPriceRecord): number {
  const sessionOrder = left.sessionDate.localeCompare(right.sessionDate);
  if (sessionOrder !== 0) return sessionOrder;
  const retrievedOrder = left.provenance.retrievedAt.localeCompare(right.provenance.retrievedAt);
  if (retrievedOrder !== 0) return retrievedOrder;
  return researchPriceRecordKey(left).localeCompare(researchPriceRecordKey(right));
}

export function latestResearchPriceRecord(records: readonly ResearchPriceRecord[]): ResearchPriceRecord | undefined {
  return [...records].sort(researchPriceRecordSortOrder).at(-1);
}
