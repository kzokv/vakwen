"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ExternalLink, ShieldCheck, X } from "lucide-react";
import type { AiConnectorScope, LocaleCode, McpOAuthConsentRequestDto } from "@vakwen/shared-types";
import { API_PUBLIC } from "../../lib/api";
import { AiClientGlyph, getConsentClientMetadata } from "./clientMetadata";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import {
  approveMcpOAuthConsent,
  denyMcpOAuthConsent,
  fetchMcpOAuthConsent,
} from "../../features/ai-inbox/service";
import { chatGptConnectorAuthorizeCopy, connectionLifecycleCopy, getAiConnectorScopeLabel } from "./i18n";

interface ChatGptConnectorAuthorizeClientProps {
  locale?: LocaleCode | string;
}

function normalizeLocale(locale?: LocaleCode | string): LocaleCode {
  return locale === "zh-TW" ? "zh-TW" : "en";
}

function scopeEnabledByPolicy(scope: AiConnectorScope, consent: McpOAuthConsentRequestDto): boolean {
  if (scope === "portfolio:mcp_read") return consent.policy.groupToggles.read;
  if (scope.startsWith("transaction_draft:")) return consent.policy.groupToggles.drafts;
  return consent.policy.groupToggles.write;
}

function isAdvancedFinancialWriteScope(scope: AiConnectorScope): boolean {
  return scope === "transaction:write" || scope === "dividend:write";
}

function scopeDefaultsGranted(scope: AiConnectorScope): boolean {
  return !isAdvancedFinancialWriteScope(scope);
}

function currentRequestId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("requestId");
}

function currentAuthorizeParams() {
  if (typeof window === "undefined") {
    return { clientId: null, redirectUri: null, resource: null };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    clientId: params.get("client_id"),
    redirectUri: params.get("redirect_uri"),
    resource: params.get("resource"),
  };
}

function scopeGroupKey(scope: AiConnectorScope): "read" | "drafts" | "write" {
  if (scope === "portfolio:mcp_read") return "read";
  if (scope.startsWith("transaction_draft:")) return "drafts";
  return "write";
}

function permissionGroupLabel(locale: LocaleCode, key: "read" | "drafts" | "write"): string {
  if (locale === "zh-TW") {
    if (key === "read") return "讀取";
    if (key === "drafts") return "草稿流程";
    return "送出與寫入";
  }
  if (key === "read") return "Read";
  if (key === "drafts") return "Draft workflow";
  return "Posting and write";
}

function redirectToAuthorizeEndpoint(): void {
  const query = window.location.search.replace(/^\?/, "");
  window.location.href = `${API_PUBLIC}/oauth/authorize${query ? `?${query}` : ""}`;
}

export function ChatGptConnectorAuthorizeClient({ locale = "en" }: ChatGptConnectorAuthorizeClientProps) {
  const resolvedLocale = normalizeLocale(locale);
  const copy = chatGptConnectorAuthorizeCopy[resolvedLocale];
  const lifecycle = connectionLifecycleCopy[resolvedLocale];
  const [connectionAction, setConnectionAction] = useState<"create" | "replace">("create");
  const [replacementConnectionId, setReplacementConnectionId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [consent, setConsent] = useState<McpOAuthConsentRequestDto | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<Set<AiConnectorScope>>(new Set());
  const [lifetimeDays, setLifetimeDays] = useState(30);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);

  const load = useCallback(async () => {
    const requestId = currentRequestId();
    if (!requestId) {
      redirectToAuthorizeEndpoint();
      return;
    }
    setError("");
    try {
      const next = await fetchMcpOAuthConsent(requestId);
      setConsent(next);
      setSelectedScopes(new Set(next.scopes.filter((scope) => scopeEnabledByPolicy(scope, next) && scopeDefaultsGranted(scope))));
      setLifetimeDays(Math.min(30, next.policy.maxConnectorLifetimeDays));
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadError);
    }
  }, [copy.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const scopeRows = useMemo(() => consent?.scopes ?? [], [consent]);
  const enabledScopes = useMemo(
    () => consent?.scopes.filter((scope) => scopeEnabledByPolicy(scope, consent)) ?? [],
    [consent],
  );
  const allScopesDisabled = consent !== null && enabledScopes.length === 0;
  const atCapacity = consent !== null && consent.activeConnectionCount >= consent.maxActiveConnectionsPerUser;
  const replacementCandidates = consent?.replacementCandidates ?? [];
  const validAction = connectionAction === "create" ? !atCapacity : replacementCandidates.some((candidate) => candidate.id === replacementConnectionId);
  const canApprove = consent !== null && selectedScopes.size > 0 && !allScopesDisabled && busy === null && !refreshing && validAction;
  const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString(resolvedLocale) : lifecycle.never;

  async function refreshConnections() {
    if (!consent || busy || refreshing) return;
    setRefreshing(true);
    try {
      const next = await fetchMcpOAuthConsent(consent.requestId);
      setConsent(next);
      setReplacementConnectionId("");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadError);
    } finally {
      setRefreshing(false);
    }
  }
  const authorizeParams = currentAuthorizeParams();
  const consentIdentity = getConsentClientMetadata({
    clientKind: consent?.clientKind,
    clientLabel: consent?.clientLabel,
    clientId: consent?.clientId ?? authorizeParams.clientId,
    redirectUri: consent?.redirectUri ?? authorizeParams.redirectUri,
  });
  const permissionGroups = useMemo(() => {
    const groups = new Set((consent?.scopes ?? []).map((scope) => scopeGroupKey(scope)));
    return [...groups];
  }, [consent]);
  const redirectNeedsRepair = !consent && error && Boolean(authorizeParams.redirectUri)
    && /(redirect|callback|allowlist|allowlisted|unapproved|invalid)/i.test(error);

  function toggleScope(scope: AiConnectorScope, checked: boolean) {
    setSelectedScopes((current) => {
      const next = new Set(current);
      if (checked) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }

  async function approve() {
    if (!consent || !canApprove) return;
    setBusy("approve");
    setError("");
    try {
      const result = await approveMcpOAuthConsent(consent.requestId, {
        csrfToken: consent.csrfToken,
        scopes: [...selectedScopes],
        lifetimeDays,
        connectionAction,
        ...(connectionAction === "replace" ? { replacementConnectionId } : {}),
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      });
      window.location.href = result.redirectUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.approveError;
      setError(/replacement.*(invalid|eligible|active|stale|revoked)|target/i.test(message) ? lifecycle.targetChanged
        : /limit|capacity/i.test(message) ? lifecycle.capacityChanged : message);
      setBusy(null);
    }
  }

  async function deny() {
    if (!consent || busy !== null) return;
    setBusy("deny");
    setError("");
    try {
      const result = await denyMcpOAuthConsent(consent.requestId, consent.csrfToken);
      window.location.href = result.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.denyError);
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center gap-3">
          <AiClientGlyph
            clientKind={consentIdentity.clientKind}
            className="h-11 w-11 rounded-lg"
          />
          <div>
            <h1 className="text-2xl font-semibold">{copy.title}</h1>
            <p className="text-sm text-slate-600">{copy.description}</p>
          </div>
        </div>

        {error ? (
          <Card className="rounded-lg border-rose-200 bg-rose-50" role="alert">
            <div className="space-y-3">
              <p className="text-sm text-rose-700">{error}</p>
              {!consent ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="secondary" onClick={() => void load()}>
                    {copy.retryRequest}
                  </Button>
                  <Button variant="outline" onClick={() => { window.location.href = consentIdentity.reconnectUrl ?? "https://chatgpt.com/"; }}>
                    {copy.startAgainInClient}
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}

        {redirectNeedsRepair ? (
          <Card className="rounded-lg border-amber-200 bg-amber-50">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <AiClientGlyph clientKind={consentIdentity.clientKind} className="mt-0.5 h-10 w-10 rounded-lg" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-950">{copy.redirectRepairTitle}</p>
                  <p className="mt-1 text-sm text-amber-900">{copy.redirectRepairBody}</p>
                </div>
              </div>
              <div className="grid gap-3 rounded-lg border border-amber-200 bg-white/70 p-4 text-sm md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase text-amber-800">{copy.detectedClient}</p>
                  <p className="mt-1 font-medium text-slate-900">{consentIdentity.label}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-amber-800">{copy.suggestedAdminFix}</p>
                  <p className="mt-1 font-medium text-slate-900">Admin MCP settings → Redirect callbacks</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs uppercase text-amber-800">{copy.exactCallback}</p>
                  <p className="mt-1 break-all font-mono text-slate-900">{authorizeParams.redirectUri}</p>
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {!consent && !error ? (
          <Card className="rounded-lg" role="status" aria-live="polite" aria-busy="true">
            <p className="text-sm text-slate-600">{copy.loadingRequest}</p>
          </Card>
        ) : null}

        {consent ? (
          <Card className="rounded-lg">
            <div className="space-y-6">
              <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase text-slate-500">{copy.client}</p>
                  <p className="mt-1 font-medium text-slate-900">{consent.clientId}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500">{copy.detectedClient}</p>
                  <div className="mt-1 flex items-center gap-2 font-medium text-slate-900">
                    <AiClientGlyph clientKind={consentIdentity.clientKind} className="h-8 w-8 rounded-lg" />
                    <span>{consentIdentity.label}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500">{copy.resource}</p>
                  <p className="mt-1 select-all break-all font-medium text-slate-900">{consent.resource}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs uppercase text-slate-500">{copy.redirect}</p>
                  <a
                    href={consent.redirectUri}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 flex items-start gap-2 break-all font-medium text-slate-900 underline decoration-slate-300 underline-offset-2"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {consent.redirectUri}
                  </a>
                </div>
                <div className="md:col-span-2">
                  <p className="text-xs uppercase text-slate-500">{copy.permissionGroups}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {permissionGroups.map((group) => (
                      <span key={group} className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {permissionGroupLabel(resolvedLocale, group)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                  <h2 className="text-base font-semibold">{copy.permissions}</h2>
                </div>
                {allScopesDisabled ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
                    {copy.policyDisabled}
                  </div>
                ) : null}
                <div className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                  {scopeRows.map((scope) => {
                    const policyDisabled = !scopeEnabledByPolicy(scope, consent);
                    const disabled = policyDisabled || busy !== null;
                    return (
                      <label key={scope} className="flex min-h-12 items-center justify-between gap-4 px-4 py-3 text-sm">
                        <span className={disabled ? "text-slate-400" : "text-slate-800"}>
                          {getAiConnectorScopeLabel(resolvedLocale, scope)}
                          {policyDisabled ? <span className="block text-xs text-slate-500">{copy.disabledByPolicy}</span> : null}
                          {isAdvancedFinancialWriteScope(scope) ? (
                            <span className="mt-1 block text-xs text-amber-700">
                              {copy.advancedScope}
                            </span>
                          ) : null}
                        </span>
                        <input
                          type="checkbox"
                          checked={selectedScopes.has(scope)}
                          disabled={disabled}
                          onChange={(event) => toggleScope(scope, event.target.checked)}
                        />
                      </label>
                    );
                  })}
                </div>
                {consent.scopes.some((scope) => isAdvancedFinancialWriteScope(scope)) ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        {copy.postingOptIn}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>

              <fieldset className="space-y-3" disabled={busy !== null || refreshing} aria-busy={refreshing}>
                <legend className="text-base font-semibold">{lifecycle.choice}</legend>
                <p className="text-sm text-slate-600">{lifecycle.capacity}: {consent.activeConnectionCount} / {consent.maxActiveConnectionsPerUser}</p>
                <label className="flex min-h-11 items-center gap-3">
                  <input type="radio" name="connectionAction" value="create" checked={connectionAction === "create"} disabled={atCapacity || busy !== null} onChange={() => { setConnectionAction("create"); setReplacementConnectionId(""); }} />
                  {lifecycle.create}
                </label>
                {atCapacity ? <p className="text-sm text-amber-800" role="status">{lifecycle.cap}</p> : null}
                <label className="flex min-h-11 items-center gap-3">
                  <input type="radio" name="connectionAction" value="replace" checked={connectionAction === "replace"} disabled={replacementCandidates.length === 0 || busy !== null} onChange={() => setConnectionAction("replace")} />
                  {lifecycle.replace}
                </label>
                {replacementCandidates.length === 0 ? <p className="text-sm text-slate-600">{lifecycle.noTargets}</p> : null}
                {connectionAction === "replace" ? (
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-medium">{lifecycle.select}</legend>
                    <p className="text-sm text-amber-800">{lifecycle.impact}</p>
                    {replacementCandidates.map((candidate) => (
                      <label key={candidate.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                        <input className="mt-1" type="radio" name="replacementConnectionId" value={candidate.id} checked={replacementConnectionId === candidate.id} onChange={() => setReplacementConnectionId(candidate.id)} />
                        <span className="min-w-0 space-y-1 text-sm">
                          <span className="block break-words font-semibold">{candidate.displayName} · {lifecycle.active}</span>
                          <span className="block break-all font-mono text-xs text-slate-500">{candidate.id}</span>
                          <span className="block">{lifecycle.created}: {dateLabel(candidate.createdAt)}</span>
                          <span className="block">{lifecycle.lastUsed}: {dateLabel(candidate.lastUsedAt)}</span>
                          <span className="block">{lifecycle.expires}: {dateLabel(candidate.expiresAt)}</span>
                          <span className="block">{lifecycle.permissions}: {candidate.scopes.map((scope) => getAiConnectorScopeLabel(resolvedLocale, scope)).join(", ")}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                <Button variant="outline" onClick={() => void refreshConnections()}>{lifecycle.refresh}</Button>
              </fieldset>
              <label className="block text-sm font-medium text-slate-700">
                {lifecycle.name}
                <input type="text" maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={busy !== null} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2" aria-describedby="connection-name-hint" />
                <span id="connection-name-hint" className="mt-1 block text-xs font-normal text-slate-600">{lifecycle.nameHint}</span>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                {copy.connectorLifetime}
                <input
                  type="number"
                  min={1}
                  max={consent.policy.maxConnectorLifetimeDays}
                  value={lifetimeDays}
                  disabled={busy !== null}
                  onChange={(event) => setLifetimeDays(Math.min(
                    consent.policy.maxConnectorLifetimeDays,
                    Math.max(1, Number(event.target.value) || 1),
                  ))}
                  className="mt-1 block w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </label>

              {busy ? <p className="sr-only" role="status" aria-live="polite">{busy === "approve" ? copy.connectorApprovalBusy : copy.connectorDenialBusy}</p> : null}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={() => void deny()} disabled={busy !== null}>
                  <X className="mr-2 h-4 w-4" aria-hidden="true" />
                  {copy.deny}
                </Button>
                <Button onClick={() => void approve()} disabled={!canApprove}>
                  <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                  {busy === "approve" ? copy.approving : copy.approve}
                </Button>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
