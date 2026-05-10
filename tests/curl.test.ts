import { describe, expect, it } from "vitest";
import { parseCurl } from "../src/parsers/curl.js";

describe("parseCurl", () => {
  it("parses a simple GET", () => {
    const spec = parseCurl("curl https://api.example.com/users");
    expect(spec.operations).toHaveLength(1);
    const op = spec.operations[0];
    expect(op.method).toBe("get");
    expect(op.path).toBe("/users");
    expect(spec.servers[0].url).toBe("https://api.example.com");
  });

  it("infers POST when -d is given without -X", () => {
    const spec = parseCurl(
      `curl -d '{"a":1}' https://api.example.com/things`
    );
    const op = spec.operations[0];
    expect(op.method).toBe("post");
    expect(op.body?.contentType).toBe("application/json");
    expect((op.body?.schema as any).properties.a).toBeDefined();
  });

  it("captures Authorization as a bearer security scheme", () => {
    const spec = parseCurl(
      `curl -H "Authorization: Bearer abc123" https://api.example.com/me`
    );
    expect(spec.securitySchemes.bearer).toBeDefined();
    expect(spec.operations[0].security).toEqual([{ schemeName: "bearer" }]);
  });

  it("parses query params from the URL", () => {
    const spec = parseCurl(
      `curl "https://api.example.com/search?q=hello&limit=10"`
    );
    const op = spec.operations[0];
    const names = op.params.map((p) => p.name).sort();
    expect(names).toEqual(["limit", "q"]);
  });

  it("respects -X override", () => {
    const spec = parseCurl(
      `curl -X DELETE https://api.example.com/users/42`
    );
    expect(spec.operations[0].method).toBe("delete");
  });

  it("handles single-quoted bodies and -H flags together", () => {
    const spec = parseCurl(
      `curl -X POST -H 'Content-Type: application/json' -d '{"name":"alice","age":30}' https://api.example.com/users`
    );
    const op = spec.operations[0];
    expect(op.method).toBe("post");
    const props = (op.body?.schema as any).properties;
    expect(props.name.type).toBe("string");
    expect(props.age.type).toBe("integer");
  });

  it("rejects input that does not start with curl", () => {
    expect(() => parseCurl("wget https://example.com")).toThrow();
  });

  it("handles backslash line continuations", () => {
    const spec = parseCurl(
      `curl https://api.example.com/users \\\n  -H "X-Trace: 1"`
    );
    expect(spec.operations[0].path).toBe("/users");
  });
});
