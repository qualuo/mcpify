import SwaggerParser from "@apidevtools/swagger-parser";

/**
 * Load and dereference an OpenAPI spec from a URL or local file path.
 * swagger-parser handles HTTP(S), local paths, JSON, and YAML transparently.
 */
export async function loadOpenApiSpec(input: string): Promise<any> {
  return await SwaggerParser.dereference(input);
}
