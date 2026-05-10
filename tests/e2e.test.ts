import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOpenApi } from "../src/parsers/openapi.js";
import { buildServer } from "../src/runtime/server.js";

describe("buildServer (e2e)", () => {
  it("registers tools matching the parsed operations", async () => {
    const text = await readFile(
      resolve(__dirname, "..", "examples", "petstore.json"),
      "utf-8"
    );
    const spec = parseOpenApi(JSON.parse(text));
    const { operations } = buildServer(spec);
    const names = operations.map((o) => o.toolName).sort();
    expect(names).toContain("findPetsByStatus");
    expect(names).toContain("addPet");
  });

  it("respects tag and maxTools filters", async () => {
    const text = await readFile(
      resolve(__dirname, "..", "examples", "petstore.json"),
      "utf-8"
    );
    const spec = parseOpenApi(JSON.parse(text));
    const { operations } = buildServer(spec, { maxTools: 2 });
    expect(operations.length).toBe(2);
  });
});
