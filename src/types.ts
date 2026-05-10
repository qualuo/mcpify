export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

export interface ParamDef {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: JsonSchema;
  description?: string;
}

export interface BodyDef {
  contentType: string;
  schema: JsonSchema;
  required: boolean;
}

export interface SecurityReq {
  schemeName: string;
  scopes?: string[];
}

export interface SecurityScheme {
  type: "http" | "apiKey" | "oauth2" | "openIdConnect" | "mutualTLS";
  scheme?: string;
  in?: "header" | "query" | "cookie";
  name?: string;
  bearerFormat?: string;
  description?: string;
}

export interface OperationDef {
  toolName: string;
  summary?: string;
  description?: string;
  method: HttpMethod;
  path: string;
  params: ParamDef[];
  body?: BodyDef;
  security: SecurityReq[];
  tags: string[];
}

export interface ServerInfo {
  url: string;
  description?: string;
}

export interface ApiSpec {
  title: string;
  version: string;
  description?: string;
  servers: ServerInfo[];
  operations: OperationDef[];
  securitySchemes: Record<string, SecurityScheme>;
  defaultSecurity: SecurityReq[];
}

export type JsonSchema = Record<string, unknown>;

export interface ServeOptions {
  baseUrl?: string;
  filterTag?: string;
  filterPattern?: RegExp;
  maxTools?: number;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
}
