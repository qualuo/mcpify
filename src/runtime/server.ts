import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildToolInputSchema } from "../parsers/openapi.js";
import type { ApiSpec, OperationDef, ServeOptions } from "../types.js";
import { executeOperation } from "./http.js";

export interface BuildServerResult {
  server: Server;
  operations: OperationDef[];
}

/**
 * Build (but don't connect) an MCP server backed by the given ApiSpec.
 * Exposed separately from `serve` so tests can drive it without stdio.
 */
export function buildServer(
  spec: ApiSpec,
  opts: ServeOptions = {}
): BuildServerResult {
  const operations = filterOps(spec.operations, opts);
  const opByName = new Map(operations.map((o) => [o.toolName, o]));

  const server = new Server(
    { name: `mcpify:${spec.title}`, version: spec.version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: operations.map((op) => ({
      name: op.toolName,
      description: buildToolDescription(op),
      inputSchema: buildToolInputSchema(op),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const op = opByName.get(name);
    if (!op) {
      return {
        isError: true,
        content: [
          { type: "text" as const, text: `Unknown tool: ${name}` },
        ],
      };
    }
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    try {
      const result = await executeOperation(spec, op, args, {
        baseUrl: opts.baseUrl,
        extraHeaders: opts.extraHeaders,
        timeoutMs: opts.timeoutMs,
      });
      return formatResult(result);
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  });

  return { server, operations };
}

export async function serve(
  spec: ApiSpec,
  opts: ServeOptions = {}
): Promise<{ operations: OperationDef[] }> {
  const { server, operations } = buildServer(spec, opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { operations };
}

function filterOps(ops: OperationDef[], opts: ServeOptions): OperationDef[] {
  let filtered = ops;
  if (opts.filterTag) {
    const tag = opts.filterTag.toLowerCase();
    filtered = filtered.filter((o) =>
      o.tags.some((t) => t.toLowerCase() === tag)
    );
  }
  if (opts.filterPattern) {
    filtered = filtered.filter((o) => opts.filterPattern!.test(o.toolName));
  }
  if (opts.maxTools && filtered.length > opts.maxTools) {
    filtered = filtered.slice(0, opts.maxTools);
  }
  return filtered;
}

function buildToolDescription(op: OperationDef): string {
  const parts: string[] = [];
  if (op.summary) parts.push(op.summary);
  if (op.description && op.description !== op.summary) parts.push(op.description);
  parts.push(`(${op.method.toUpperCase()} ${op.path})`);
  return parts.join("\n\n");
}

function formatResult(result: {
  status: number;
  statusText: string;
  body: string;
  parsedBody?: unknown;
  truncated: boolean;
}): { content: { type: "text"; text: string }[]; isError?: boolean } {
  const isError = result.status >= 400;
  const header = `HTTP ${result.status} ${result.statusText}`;
  let bodyText: string;
  if (result.parsedBody !== undefined) {
    bodyText = JSON.stringify(result.parsedBody, null, 2);
  } else {
    bodyText = result.body;
  }
  if (result.truncated) {
    bodyText += "\n\n[response truncated to 64KB]";
  }
  return {
    isError,
    content: [
      {
        type: "text",
        text: `${header}\n\n${bodyText}`,
      },
    ],
  };
}
