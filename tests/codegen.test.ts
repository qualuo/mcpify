import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateProject } from "../src/generate/codegen.js";
import { parseOpenApi } from "../src/parsers/openapi.js";

describe("generateProject", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "unmcp-codegen-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("emits a runnable project with package.json + spec embed", async () => {
    const doc = JSON.parse(
      await readFile(
        join(__dirname, "..", "examples", "petstore.json"),
        "utf-8"
      )
    );
    const spec = parseOpenApi(doc);
    const result = await generateProject(spec, dir, { name: "pet-mcp" });
    expect(result.files).toContain("package.json");
    expect(result.files).toContain("src/server.ts");
    expect(result.files).toContain("src/spec.json");

    const pkg = JSON.parse(
      await readFile(join(dir, "package.json"), "utf-8")
    );
    expect(pkg.name).toBe("pet-mcp");
    expect(pkg.dependencies.unmcp).toBeDefined();

    const embedded = JSON.parse(
      await readFile(join(dir, "src", "spec.json"), "utf-8")
    );
    expect(embedded.title).toBe("Petstore");
  });
});
