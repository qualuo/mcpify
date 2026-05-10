import type { ApiSpec, SecurityReq, SecurityScheme } from "../types.js";

export interface ResolvedAuth {
  headers: Record<string, string>;
  query: Record<string, string>;
}

const NONE: ResolvedAuth = Object.freeze({ headers: {}, query: {} }) as any;

/**
 * Resolve auth from environment variables.
 *
 * Lookup order for a security scheme named `<NAME>`:
 *   1. UNMCP_AUTH_<NAME_UPPER>          (raw token / value)
 *   2. UNMCP_BEARER_TOKEN               (HTTP bearer fallback)
 *   3. UNMCP_API_KEY                    (apiKey fallback)
 *   4. UNMCP_BASIC_AUTH                 (Basic, expects "user:pass" or pre-encoded)
 *
 * Plus a generic envelope:
 *   - UNMCP_HEADERS — JSON object merged into every request's headers
 */
export function resolveAuth(
  spec: ApiSpec,
  opSecurity: SecurityReq[],
  env: NodeJS.ProcessEnv = process.env
): ResolvedAuth {
  const requirements = opSecurity.length > 0 ? opSecurity : spec.defaultSecurity;
  if (requirements.length === 0) {
    return cloneAuth(NONE);
  }

  for (const req of requirements) {
    const scheme = spec.securitySchemes[req.schemeName];
    if (!scheme) continue;
    const resolved = applyScheme(req.schemeName, scheme, env);
    if (resolved) return resolved;
  }

  return cloneAuth(NONE);
}

function applyScheme(
  name: string,
  scheme: SecurityScheme,
  env: NodeJS.ProcessEnv
): ResolvedAuth | null {
  const upper = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const specific = env[`UNMCP_AUTH_${upper}`];

  if (scheme.type === "http") {
    const httpScheme = (scheme.scheme || "").toLowerCase();
    if (httpScheme === "bearer") {
      const token = specific || env.UNMCP_BEARER_TOKEN;
      if (!token) return null;
      return {
        headers: { Authorization: `Bearer ${token}` },
        query: {},
      };
    }
    if (httpScheme === "basic") {
      const raw = specific || env.UNMCP_BASIC_AUTH;
      if (!raw) return null;
      const encoded = raw.includes(":")
        ? Buffer.from(raw, "utf-8").toString("base64")
        : raw;
      return {
        headers: { Authorization: `Basic ${encoded}` },
        query: {},
      };
    }
    return null;
  }

  if (scheme.type === "apiKey") {
    const value = specific || env.UNMCP_API_KEY;
    if (!value || !scheme.name) return null;
    if (scheme.in === "header") {
      return { headers: { [scheme.name]: value }, query: {} };
    }
    if (scheme.in === "query") {
      return { headers: {}, query: { [scheme.name]: value } };
    }
    return null;
  }

  if (scheme.type === "oauth2" || scheme.type === "openIdConnect") {
    // We don't run a flow — accept a pre-fetched access token.
    const token = specific || env.UNMCP_BEARER_TOKEN;
    if (!token) return null;
    return {
      headers: { Authorization: `Bearer ${token}` },
      query: {},
    };
  }

  return null;
}

export function extraHeadersFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const raw = env.UNMCP_HEADERS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    // ignore — malformed JSON is a user error, not fatal.
  }
  return {};
}

function cloneAuth(a: ResolvedAuth): ResolvedAuth {
  return { headers: { ...a.headers }, query: { ...a.query } };
}
