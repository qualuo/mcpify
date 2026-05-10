import { describe, expect, it } from "vitest";
import { extraHeadersFromEnv, resolveAuth } from "../src/runtime/auth.js";
import type { ApiSpec } from "../src/types.js";

const baseSpec: ApiSpec = {
  title: "T",
  version: "1",
  servers: [{ url: "https://api.example.com" }],
  operations: [],
  securitySchemes: {},
  defaultSecurity: [],
};

describe("resolveAuth", () => {
  it("returns nothing when no security is required", () => {
    const result = resolveAuth(baseSpec, [], {});
    expect(result.headers).toEqual({});
    expect(result.query).toEqual({});
  });

  it("applies a bearer token from MCPIFY_BEARER_TOKEN", () => {
    const spec: ApiSpec = {
      ...baseSpec,
      securitySchemes: { mainAuth: { type: "http", scheme: "bearer" } },
    };
    const result = resolveAuth(spec, [{ schemeName: "mainAuth" }], {
      MCPIFY_BEARER_TOKEN: "abc",
    });
    expect(result.headers.Authorization).toBe("Bearer abc");
  });

  it("prefers scheme-specific env over generic", () => {
    const spec: ApiSpec = {
      ...baseSpec,
      securitySchemes: { mainAuth: { type: "http", scheme: "bearer" } },
    };
    const result = resolveAuth(spec, [{ schemeName: "mainAuth" }], {
      MCPIFY_AUTH_MAINAUTH: "specific",
      MCPIFY_BEARER_TOKEN: "generic",
    });
    expect(result.headers.Authorization).toBe("Bearer specific");
  });

  it("places apiKey in the configured location", () => {
    const spec: ApiSpec = {
      ...baseSpec,
      securitySchemes: {
        ApiKey: { type: "apiKey", in: "query", name: "api_key" },
      },
    };
    const result = resolveAuth(spec, [{ schemeName: "ApiKey" }], {
      MCPIFY_API_KEY: "k",
    });
    expect(result.query.api_key).toBe("k");
    expect(result.headers).toEqual({});
  });

  it("base64-encodes basic auth from user:pass", () => {
    const spec: ApiSpec = {
      ...baseSpec,
      securitySchemes: { basic: { type: "http", scheme: "basic" } },
    };
    const result = resolveAuth(spec, [{ schemeName: "basic" }], {
      MCPIFY_BASIC_AUTH: "alice:secret",
    });
    const expected = Buffer.from("alice:secret").toString("base64");
    expect(result.headers.Authorization).toBe(`Basic ${expected}`);
  });

  it("returns empty when no env var matches", () => {
    const spec: ApiSpec = {
      ...baseSpec,
      securitySchemes: { mainAuth: { type: "http", scheme: "bearer" } },
    };
    const result = resolveAuth(spec, [{ schemeName: "mainAuth" }], {});
    expect(result.headers).toEqual({});
  });
});

describe("extraHeadersFromEnv", () => {
  it("parses a JSON object from MCPIFY_HEADERS", () => {
    const result = extraHeadersFromEnv({
      MCPIFY_HEADERS: '{"X-A":"1","X-B":"2"}',
    });
    expect(result).toEqual({ "X-A": "1", "X-B": "2" });
  });

  it("ignores malformed JSON", () => {
    const result = extraHeadersFromEnv({ MCPIFY_HEADERS: "not json" });
    expect(result).toEqual({});
  });
});
