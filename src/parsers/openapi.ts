import type {
  ApiSpec,
  BodyDef,
  HttpMethod,
  JsonSchema,
  OperationDef,
  ParamDef,
  SecurityReq,
  SecurityScheme,
  ServerInfo,
} from "../types.js";

const HTTP_METHODS: HttpMethod[] = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
];

/**
 * Convert a dereferenced OpenAPI 3.x document into our internal ApiSpec.
 * Tolerates Swagger 2.0 if it has been pre-converted; otherwise expects v3+.
 */
export function parseOpenApi(doc: any): ApiSpec {
  if (!doc || typeof doc !== "object") {
    throw new Error("Spec is empty or not an object");
  }

  const info = doc.info || {};
  const title = info.title || "Untitled API";
  const version = info.version || "0.0.0";
  const description = info.description;

  const servers = parseServers(doc.servers);
  const securitySchemes = parseSecuritySchemes(doc.components?.securitySchemes);
  const defaultSecurity = parseSecurityList(doc.security);

  const operations: OperationDef[] = [];
  const paths = doc.paths || {};
  const seenNames = new Set<string>();

  for (const [path, pathItem] of Object.entries<any>(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const pathLevelParams = Array.isArray(pathItem.parameters)
      ? pathItem.parameters
      : [];

    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op || typeof op !== "object") continue;

      const allParams = mergeParams(pathLevelParams, op.parameters || []);
      const params = allParams
        .map(parseParameter)
        .filter((p): p is ParamDef => p !== null);

      const body = parseRequestBody(op.requestBody);
      const security = op.security
        ? parseSecurityList(op.security)
        : defaultSecurity;

      const baseName =
        op.operationId ||
        `${method}_${path.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
      const toolName = uniqueName(sanitizeName(baseName), seenNames);

      operations.push({
        toolName,
        summary: op.summary,
        description: op.description,
        method,
        path,
        params,
        body,
        security,
        tags: Array.isArray(op.tags) ? op.tags : [],
      });
    }
  }

  return {
    title,
    version,
    description,
    servers,
    operations,
    securitySchemes,
    defaultSecurity,
  };
}

function parseServers(servers: any): ServerInfo[] {
  if (!Array.isArray(servers) || servers.length === 0) {
    return [];
  }
  return servers
    .map((s) => {
      if (!s || typeof s !== "object" || typeof s.url !== "string") return null;
      return { url: s.url, description: s.description } as ServerInfo;
    })
    .filter((s): s is ServerInfo => s !== null);
}

function parseSecuritySchemes(
  schemes: any
): Record<string, SecurityScheme> {
  if (!schemes || typeof schemes !== "object") return {};
  const out: Record<string, SecurityScheme> = {};
  for (const [name, scheme] of Object.entries<any>(schemes)) {
    if (!scheme || typeof scheme !== "object") continue;
    out[name] = {
      type: scheme.type,
      scheme: scheme.scheme,
      in: scheme.in,
      name: scheme.name,
      bearerFormat: scheme.bearerFormat,
      description: scheme.description,
    };
  }
  return out;
}

function parseSecurityList(security: any): SecurityReq[] {
  if (!Array.isArray(security)) return [];
  const out: SecurityReq[] = [];
  for (const entry of security) {
    if (!entry || typeof entry !== "object") continue;
    for (const [schemeName, scopes] of Object.entries(entry)) {
      out.push({
        schemeName,
        scopes: Array.isArray(scopes) ? (scopes as string[]) : [],
      });
    }
  }
  return out;
}

function mergeParams(pathLevel: any[], opLevel: any[]): any[] {
  const map = new Map<string, any>();
  for (const p of pathLevel) {
    if (p && p.name && p.in) map.set(`${p.in}:${p.name}`, p);
  }
  for (const p of opLevel) {
    if (p && p.name && p.in) map.set(`${p.in}:${p.name}`, p);
  }
  return [...map.values()];
}

function parseParameter(p: any): ParamDef | null {
  if (!p || typeof p !== "object") return null;
  if (!p.name || !p.in) return null;
  if (p.in !== "path" && p.in !== "query" && p.in !== "header") return null;
  // Skip auth-style headers — those are injected by the auth layer.
  if (p.in === "header" && /^authorization$/i.test(p.name)) return null;
  return {
    name: p.name,
    in: p.in,
    required: p.in === "path" ? true : Boolean(p.required),
    schema: cleanSchema(p.schema || { type: "string" }),
    description: p.description,
  };
}

function parseRequestBody(rb: any): BodyDef | undefined {
  if (!rb || typeof rb !== "object") return undefined;
  const content = rb.content;
  if (!content || typeof content !== "object") return undefined;

  // Prefer application/json; fall back to first available.
  const preferred = ["application/json", "application/x-www-form-urlencoded"];
  let chosenType: string | null = null;
  for (const t of preferred) {
    if (content[t]) {
      chosenType = t;
      break;
    }
  }
  if (!chosenType) {
    chosenType = Object.keys(content)[0] || null;
  }
  if (!chosenType) return undefined;

  const schema = content[chosenType]?.schema;
  return {
    contentType: chosenType,
    schema: cleanSchema(schema || { type: "object" }),
    required: Boolean(rb.required),
  };
}

/**
 * Strip OpenAPI-only keywords (e.g., `nullable`, `example`) and translate to
 * something MCP/JSON-Schema clients reliably accept. Recursive.
 */
function cleanSchema(schema: any): JsonSchema {
  if (!schema || typeof schema !== "object") {
    return { type: "string" };
  }
  const out: any = { ...schema };

  // OpenAPI 3.0 `nullable: true` -> JSON Schema `type: [..., "null"]`
  if (out.nullable === true) {
    if (typeof out.type === "string") {
      out.type = [out.type, "null"];
    }
    delete out.nullable;
  }

  // Drop fields that confuse strict validators.
  delete out.example;
  delete out.examples;
  delete out.xml;
  delete out.externalDocs;
  delete out.discriminator;
  delete out.readOnly;
  delete out.writeOnly;

  if (out.properties && typeof out.properties === "object") {
    const cleaned: Record<string, JsonSchema> = {};
    for (const [k, v] of Object.entries(out.properties)) {
      cleaned[k] = cleanSchema(v);
    }
    out.properties = cleaned;
  }
  if (out.items) {
    out.items = cleanSchema(out.items);
  }
  if (Array.isArray(out.allOf)) {
    out.allOf = out.allOf.map(cleanSchema);
  }
  if (Array.isArray(out.anyOf)) {
    out.anyOf = out.anyOf.map(cleanSchema);
  }
  if (Array.isArray(out.oneOf)) {
    out.oneOf = out.oneOf.map(cleanSchema);
  }
  return out;
}

function sanitizeName(name: string): string {
  // MCP tool names: keep alnum + underscore; collapse runs.
  return (
    name
      .replace(/[^a-zA-Z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "tool"
  );
}

function uniqueName(name: string, seen: Set<string>): string {
  if (!seen.has(name)) {
    seen.add(name);
    return name;
  }
  let i = 2;
  while (seen.has(`${name}_${i}`)) i++;
  const final = `${name}_${i}`;
  seen.add(final);
  return final;
}

/**
 * Build the JSON Schema describing a tool's input from its operation.
 * Path/query/header params become top-level properties; body becomes a
 * nested `body` property to avoid name collisions.
 */
export function buildToolInputSchema(op: OperationDef): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const p of op.params) {
    const propSchema: JsonSchema = { ...p.schema };
    if (p.description && !propSchema.description) {
      propSchema.description = `[${p.in}] ${p.description}`;
    } else if (!propSchema.description) {
      propSchema.description = `[${p.in}] parameter`;
    }
    properties[p.name] = propSchema;
    if (p.required) required.push(p.name);
  }

  if (op.body) {
    properties.body = {
      ...op.body.schema,
      description:
        (op.body.schema as any).description ||
        `Request body (${op.body.contentType})`,
    };
    if (op.body.required) required.push("body");
  }

  const schema: JsonSchema = {
    type: "object",
    properties,
  };
  if (required.length > 0) schema.required = required;
  return schema;
}
