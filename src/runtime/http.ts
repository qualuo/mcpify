import type { ApiSpec, OperationDef } from "../types.js";
import { extraHeadersFromEnv, resolveAuth } from "./auth.js";

export interface ExecuteResult {
  status: number;
  statusText: string;
  contentType: string | null;
  body: string;
  parsedBody?: unknown;
  truncated: boolean;
}

const MAX_BODY_BYTES = 64 * 1024;

export interface ExecuteOptions {
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

export async function executeOperation(
  spec: ApiSpec,
  op: OperationDef,
  args: Record<string, unknown>,
  opts: ExecuteOptions = {}
): Promise<ExecuteResult> {
  const baseUrl = (opts.baseUrl || spec.servers[0]?.url || "").replace(
    /\/+$/,
    ""
  );
  if (!baseUrl) {
    throw new Error(
      "No base URL is configured. Pass --base-url, set UNMCP_BASE_URL, " +
        "or use a spec with at least one `servers` entry."
    );
  }

  const auth = resolveAuth(spec, op.security, opts.env);
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...auth.headers,
    ...extraHeadersFromEnv(opts.env),
    ...(opts.extraHeaders || {}),
  };

  // Substitute path params.
  let path = op.path;
  for (const p of op.params.filter((x) => x.in === "path")) {
    const value = args[p.name];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing required path parameter: ${p.name}`);
    }
    path = path.replace(
      `{${p.name}}`,
      encodeURIComponent(String(value))
    );
  }

  // Build URL with query params.
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(auth.query)) {
    url.searchParams.set(k, v);
  }
  for (const p of op.params.filter((x) => x.in === "query")) {
    const value = args[p.name];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(p.name, String(v));
    } else {
      url.searchParams.set(p.name, String(value));
    }
  }

  // Header params (non-auth).
  for (const p of op.params.filter((x) => x.in === "header")) {
    const value = args[p.name];
    if (value === undefined || value === null) continue;
    headers[p.name] = String(value);
  }

  // Body.
  let body: string | undefined;
  if (op.body && args.body !== undefined) {
    if (op.body.contentType === "application/json") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(args.body);
    } else if (op.body.contentType === "application/x-www-form-urlencoded") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const params = new URLSearchParams();
      const bodyObj = args.body as Record<string, unknown>;
      for (const [k, v] of Object.entries(bodyObj || {})) {
        if (v !== undefined && v !== null) params.set(k, String(v));
      }
      body = params.toString();
    } else {
      headers["Content-Type"] = op.body.contentType;
      body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
    }
  }

  const fetchImpl = opts.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 30000
  );

  try {
    const res = await fetchImpl(url.toString(), {
      method: op.method.toUpperCase(),
      headers,
      body,
      signal: controller.signal,
    });
    return await readResponse(res);
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponse(res: Response): Promise<ExecuteResult> {
  const contentType = res.headers.get("content-type");
  const buf = Buffer.from(await res.arrayBuffer());
  const truncated = buf.length > MAX_BODY_BYTES;
  const slice = truncated ? buf.subarray(0, MAX_BODY_BYTES) : buf;
  const text = slice.toString("utf-8");

  let parsedBody: unknown | undefined;
  if (contentType?.includes("application/json")) {
    try {
      parsedBody = JSON.parse(text);
    } catch {
      // not valid JSON despite the header — leave as text.
    }
  }

  return {
    status: res.status,
    statusText: res.statusText,
    contentType,
    body: text,
    parsedBody,
    truncated,
  };
}
