import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildToolInputSchema, parseOpenApi } from "../src/parsers/openapi.js";

async function loadFixture(name: string): Promise<any> {
  const text = await readFile(
    resolve(__dirname, "..", "examples", name),
    "utf-8"
  );
  return JSON.parse(text);
}

describe("parseOpenApi", () => {
  it("extracts operations from the petstore spec", async () => {
    const doc = await loadFixture("petstore.json");
    const spec = parseOpenApi(doc);

    expect(spec.title).toBe("Petstore");
    expect(spec.servers[0].url).toBe("https://petstore3.swagger.io/api/v3");

    const names = spec.operations.map((o) => o.toolName).sort();
    expect(names).toContain("findPetsByStatus");
    expect(names).toContain("getPetById");
    expect(names).toContain("addPet");
    expect(names).toContain("deletePet");
  });

  it("preserves path/query/body distinctions", async () => {
    const doc = await loadFixture("petstore.json");
    const spec = parseOpenApi(doc);

    const get = spec.operations.find((o) => o.toolName === "getPetById")!;
    expect(get.method).toBe("get");
    expect(get.params).toEqual([
      expect.objectContaining({ name: "petId", in: "path", required: true }),
    ]);

    const add = spec.operations.find((o) => o.toolName === "addPet")!;
    expect(add.body?.contentType).toBe("application/json");
    expect(add.body?.required).toBe(true);
  });

  it("falls back to method+path when operationId is missing", () => {
    const doc = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/widgets/{id}": {
          get: { responses: { "200": { description: "ok" } } },
        },
      },
    };
    const spec = parseOpenApi(doc);
    expect(spec.operations).toHaveLength(1);
    expect(spec.operations[0].toolName).toBe("get_widgets_id");
  });

  it("avoids duplicate tool names", () => {
    const doc = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/a": { get: { operationId: "list" } },
        "/b": { get: { operationId: "list" } },
      },
    };
    const spec = parseOpenApi(doc);
    const names = spec.operations.map((o) => o.toolName);
    expect(new Set(names).size).toBe(2);
  });

  it("strips OpenAPI-only schema keywords", () => {
    const doc = {
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      paths: {
        "/x": {
          get: {
            operationId: "x",
            parameters: [
              {
                name: "q",
                in: "query",
                schema: {
                  type: "string",
                  example: "hello",
                  nullable: true,
                },
              },
            ],
          },
        },
      },
    };
    const spec = parseOpenApi(doc);
    const schema = spec.operations[0].params[0].schema as any;
    expect(schema.example).toBeUndefined();
    expect(schema.nullable).toBeUndefined();
    expect(schema.type).toEqual(["string", "null"]);
  });
});

describe("buildToolInputSchema", () => {
  it("composes path/query params and a nested body", async () => {
    const doc = await loadFixture("petstore.json");
    const spec = parseOpenApi(doc);
    const add = spec.operations.find((o) => o.toolName === "addPet")!;
    const schema = buildToolInputSchema(add) as any;
    expect(schema.type).toBe("object");
    expect(schema.properties.body).toBeDefined();
    expect(schema.required).toContain("body");
  });
});
