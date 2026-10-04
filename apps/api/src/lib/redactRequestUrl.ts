// Never persist OAuth bridge payloads or credentials supplied as query parameters.
const sensitiveQueryKeys = new Set(["access_token", "refresh_token", "token", "code", "code_verifier", "client_secret", "client_assertion"]);
export function redactRequestUrl(url: string): string {
  const redactedPath = url.replace(/\/share\/[A-Za-z0-9]{22}(?=[/?#]|$)/g, "/share/[REDACTED]");
  const queryIndex = redactedPath.indexOf("?");
  if (queryIndex < 0) return redactedPath;
  const pathname = redactedPath.slice(0, queryIndex);
  const query = new URLSearchParams(redactedPath.slice(queryIndex + 1));
  if (/^\/oauth(?:\/|$)/.test(pathname)
    || [...query.keys()].some(key => sensitiveQueryKeys.has(key.toLowerCase()))) {
    return `${pathname}?[REDACTED]`;
  }
  return redactedPath;
}
