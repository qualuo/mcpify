import type { ApiSpec, HttpMethod, OperationDef } from "../types.js";

const VALID_METHODS = new Set<HttpMethod>([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

interface ParsedCurl {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Parse a curl command string into a single-operation ApiSpec.
 * Supports: -X / --request, -H / --header, -d / --data / --data-raw / --data-binary,
 * --url, basic shell quoting (single + double).
 */
export function parseCurl(input: string): ApiSpec {
  const tokens = tokenize(input);
  if (tokens.length === 0 || tokens[0].toLowerCase() !== "curl") {
    throw new Error("Input must begin with `curl`");
  }
  const curl = parseTokens(tokens.slice(1));

  const url = new URL(curl.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const path = url.pathname || "/";

  const op: OperationDef = {
    toolName: deriveToolName(curl.method, path),
    summary: `${curl.method.toUpperCase()} ${path}`,
    description: `Generated from curl: ${curl.method.toUpperCase()} ${url.toString()}`,
    method: curl.method,
    path,
    params: queryParamsFromUrl(url),
    body: curl.body
      ? {
          contentType: curl.headers["content-type"] || "application/json",
          schema: inferBodySchema(curl.body),
          required: true,
        }
      : undefined,
    security: [],
    tags: [],
  };

  // Authorization headers from the curl become an implicit Bearer scheme.
  const securitySchemes: ApiSpec["securitySchemes"] = {};
  if (curl.headers.authorization) {
    securitySchemes.bearer = {
      type: "http",
      scheme: "bearer",
      description: "Detected from curl Authorization header",
    };
    op.security = [{ schemeName: "bearer" }];
  }

  return {
    title: `curl ${url.host}`,
    version: "0.0.0",
    description: `Generated from curl command targeting ${url.host}`,
    servers: [{ url: baseUrl }],
    operations: [op],
    securitySchemes,
    defaultSecurity: [],
  };
}

function deriveToolName(method: HttpMethod, path: string): string {
  const slug = path
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .slice(0, 40);
  return `${method}_${slug || "root"}`;
}

function queryParamsFromUrl(url: URL): OperationDef["params"] {
  const params: OperationDef["params"] = [];
  for (const [name, value] of url.searchParams.entries()) {
    params.push({
      name,
      in: "query",
      required: false,
      schema: { type: "string", default: value },
      description: `Query parameter (default: ${value})`,
    });
  }
  return params;
}

function inferBodySchema(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body);
    return jsonToSchema(parsed);
  } catch {
    return {
      type: "string",
      description: "Raw request body",
      default: body,
    };
  }
}

function jsonToSchema(value: unknown): Record<string, unknown> {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length > 0 ? jsonToSchema(value[0]) : { type: "string" },
    };
  }
  switch (typeof value) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: Number.isInteger(value) ? "integer" : "number" };
    case "boolean":
      return { type: "boolean" };
    case "object": {
      const props: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(value as object)) {
        props[k] = jsonToSchema(v);
        required.push(k);
      }
      return { type: "object", properties: props, required };
    }
    default:
      return { type: "string" };
  }
}

function parseTokens(tokens: string[]): ParsedCurl {
  let method: HttpMethod = "get";
  let url = "";
  const headers: Record<string, string> = {};
  let body: string | undefined;
  let methodExplicit = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "-X" || tok === "--request") {
      const m = (tokens[++i] || "").toLowerCase();
      if (VALID_METHODS.has(m as HttpMethod)) {
        method = m as HttpMethod;
        methodExplicit = true;
      }
    } else if (tok === "-H" || tok === "--header") {
      const h = tokens[++i] || "";
      const idx = h.indexOf(":");
      if (idx > 0) {
        const k = h.slice(0, idx).trim().toLowerCase();
        const v = h.slice(idx + 1).trim();
        headers[k] = v;
      }
    } else if (
      tok === "-d" ||
      tok === "--data" ||
      tok === "--data-raw" ||
      tok === "--data-binary" ||
      tok === "--data-ascii"
    ) {
      body = tokens[++i] || "";
      if (!methodExplicit) method = "post";
    } else if (tok === "--url") {
      url = tokens[++i] || "";
    } else if (
      tok === "-A" ||
      tok === "--user-agent" ||
      tok === "-u" ||
      tok === "--user" ||
      tok === "-e" ||
      tok === "--referer" ||
      tok === "--cookie" ||
      tok === "-b" ||
      tok === "--cookie-jar" ||
      tok === "-c"
    ) {
      // Consume the value but ignore for now.
      i++;
    } else if (tok.startsWith("-")) {
      // Unknown flag with possible value — skip the next token if it doesn't look like a flag.
      const next = tokens[i + 1];
      if (next && !next.startsWith("-") && !next.startsWith("http")) i++;
    } else if (!url && /^https?:\/\//i.test(tok)) {
      url = tok;
    }
  }

  if (!url) throw new Error("Could not find a URL in the curl command");
  return { method, url, headers, body };
}

/** Tokenize a shell-ish string respecting single/double quotes and backslash escapes. */
function tokenize(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  let quote: '"' | "'" | null = null;

  while (i < input.length) {
    const c = input[i];

    if (quote) {
      if (c === "\\" && quote === '"' && i + 1 < input.length) {
        cur += input[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) {
        quote = null;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }

    if (c === '"' || c === "'") {
      quote = c;
      i++;
      continue;
    }

    if (c === "\\" && i + 1 < input.length) {
      const next = input[i + 1];
      // Treat `\\\n` and `\\ ` as line continuations / escaped spaces.
      if (next === "\n") {
        i += 2;
        continue;
      }
      cur += next;
      i += 2;
      continue;
    }

    if (/\s/.test(c)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = "";
      }
      i++;
      continue;
    }

    cur += c;
    i++;
  }

  if (cur.length > 0) out.push(cur);
  return out;
}
