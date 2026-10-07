// Shared exposure boundary for stored provenance and official acquisition URLs.
// Match decoded parameter names, never substrings in benign routing values.
const credentialParameters = new Set([
  "token", "accesstoken", "refreshtoken", "idtoken", "authtoken", "oauthtoken", "bearertoken", "securitytoken", "sessiontoken",
  "key", "apikey", "xapikey", "accesskey", "accesskeyid", "secretkey", "subscriptionkey", "ocpapimsubscriptionkey",
  "secret", "clientsecret", "apisecret", "password", "passwd", "pwd",
  "auth", "authorization", "authentication", "credential", "credentials",
  "signature", "sig", "hmac", "sharedaccesssignature", "sharedaccesskey", "sas", "sastoken",
  "awsaccesskeyid", "awssecretaccesskey", "awssessiontoken", "xamzcredential", "xamzsignature", "xamzsecuritytoken", "xamzaccesstoken",
  "googleaccessid", "xgoogcredential", "xgoogsignature", "xgoogsecuritytoken", "keypairid",
]);

function credentialBearingParameters(parameters: URLSearchParams): boolean {
  for (const parameter of parameters.keys()) {
    // URLSearchParams performs the first percent-decoding pass. Reject nested
    // encodings too: forwarding gateways can decode those again.
    let decoded = parameter;
    for (let attempt = 0; attempt < 4 && decoded.includes("%"); attempt++) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch { return true; }
    }
    if (decoded.includes("%")) return true;
    const normalized = decoded.normalize("NFKC").toLowerCase().replace(/[\s_.-]/g, "");
    if (credentialParameters.has(normalized)) return true;
  }
  return false;
}

export function isCredentialFreeDisclosureUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || credentialBearingParameters(url.searchParams)) return false;
    // OAuth-style fragments can also carry tokens even though servers do not
    // receive them. Ordinary SPA fragments and MOPS routing parameters survive.
    const fragment = url.hash.slice(1);
    const fragmentParameters = fragment.includes("?") ? fragment.slice(fragment.indexOf("?") + 1) : fragment;
    return !credentialBearingParameters(new URLSearchParams(fragmentParameters));
  } catch { return false; }
}
