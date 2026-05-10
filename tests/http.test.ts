import { describe, expect, it, vi } from "vitest";
import { executeOperation } from "../src/runtime/http.js";
import type { ApiSpec, OperationDef } from "../src/types.js";

function spec(): ApiSpec {
  return {
    title: "T",
    version: "1",
    servers: [{ url: "https://api.example.com" }],
    operations: [],
    securitySchemes: {},
    defaultSecurity: [],
  };
}

function op(overrides: Partial<OperationDef> = {}): OperationDef {
  return {
    toolName: "x",
    method: "get",
    path: "/x",
    params: [],
    security: [],
    tags: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("executeOperation", () => {
  it("substitutes path params and applies query params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await executeOperation(
      spec(),
      op({
        method: "get",
        path: "/users/{id}",
        params: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
          {
            name: "expand",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
        ],
      }),
      { id: 42, expand: "profile" },
      { fetchImpl, env: {} }
    );
    const url = fetchImpl.mock.calls[0][0];
    expect(url).toBe("https://api.example.com/users/42?expand=profile");
  });

  it("sends a JSON body when configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }, 201));
    await executeOperation(
      spec(),
      op({
        method: "post",
        path: "/things",
        body: {
          contentType: "application/json",
          required: true,
          schema: { type: "object" },
        },
      }),
      { body: { name: "thing" } },
      { fetchImpl, env: {} }
    );
    const init = fetchImpl.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ name: "thing" });
  });

  it("throws when a required path param is missing", async () => {
    const fetchImpl = vi.fn();
    await expect(
      executeOperation(
        spec(),
        op({
          method: "get",
          path: "/users/{id}",
          params: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
        }),
        {},
        { fetchImpl, env: {} }
      )
    ).rejects.toThrow(/Missing required path parameter/);
  });

  it("uses --base-url override over the spec's server", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    await executeOperation(spec(), op(), {}, {
      fetchImpl,
      baseUrl: "https://staging.example.com",
      env: {},
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://staging.example.com/x");
  });

  it("attaches resolved auth headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const s: ApiSpec = {
      ...spec(),
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    };
    await executeOperation(
      s,
      op({ security: [{ schemeName: "bearer" }] }),
      {},
      { fetchImpl, env: { UNMCP_BEARER_TOKEN: "tok" } }
    );
    const init = fetchImpl.mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer tok");
  });
});
