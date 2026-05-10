#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import kleur from "kleur";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { generateProject } from "./generate/codegen.js";
import { loadOpenApiSpec } from "./loader.js";
import { parseCurl } from "./parsers/curl.js";
import { parseOpenApi } from "./parsers/openapi.js";
import { serve } from "./runtime/server.js";
import type { ApiSpec } from "./types.js";

// stdout is reserved for the MCP transport when running `serve`.
// All informational output goes to stderr.
const log = (msg: string) => process.stderr.write(msg + "\n");

async function main(): Promise<void> {
  await yargs(hideBin(process.argv))
    .scriptName("mcpify")
    .usage(
      "$0 <command> [options]\n\nTurn any OpenAPI spec or curl command into an MCP server."
    )
    .command(
      ["serve <spec>", "$0 <spec>"],
      "Start an MCP server backed by an OpenAPI spec or curl command",
      (y) =>
        y
          .positional("spec", {
            describe: "Path or URL to an OpenAPI spec (or `curl` for --curl mode)",
            type: "string",
          })
          .option("curl", {
            type: "string",
            describe:
              "Treat the input as a curl command instead of an OpenAPI spec",
          })
          .option("base-url", {
            type: "string",
            describe: "Override the base URL from the spec",
          })
          .option("tag", {
            type: "string",
            describe: "Only expose operations matching this tag",
          })
          .option("filter", {
            type: "string",
            describe: "Regex applied to tool names",
          })
          .option("max-tools", {
            type: "number",
            describe: "Cap the number of tools exposed",
          })
          .option("header", {
            type: "array",
            describe:
              "Extra header to attach to every request (repeatable). Format: 'X-Foo: bar'",
          }),
      async (argv) => {
        const spec = await loadSpec(argv);
        const opts = optsFromArgs(argv);
        const { operations } = await serve(spec, opts);
        // Logged after `serve` connects so MCP clients can see the count
        // immediately on stderr.
        log(
          kleur.green("✓") +
            ` ${kleur.bold("mcpify")}: ${spec.title} v${spec.version} — ` +
            `${operations.length} tool${operations.length === 1 ? "" : "s"}`
        );
        if (opts.baseUrl || spec.servers[0]) {
          log(
            kleur.dim("  base: ") +
              (opts.baseUrl || spec.servers[0]?.url || "(none)")
          );
        }
        log(kleur.dim("  transport: stdio"));
      }
    )
    .command(
      "list <spec>",
      "Print the list of tools that would be exposed",
      (y) =>
        y
          .positional("spec", {
            describe: "Path or URL to an OpenAPI spec",
            type: "string",
          })
          .option("curl", { type: "string" })
          .option("tag", { type: "string" })
          .option("filter", { type: "string" }),
      async (argv) => {
        const spec = await loadSpec(argv);
        const opts = optsFromArgs(argv);
        const filtered = applyFilters(spec.operations, opts);
        log(kleur.bold(`${spec.title}`) + kleur.dim(` v${spec.version}`));
        log(
          kleur.dim(
            `${filtered.length} of ${spec.operations.length} operations`
          )
        );
        log("");
        for (const op of filtered) {
          const tag = op.tags[0] ? kleur.dim(`[${op.tags[0]}] `) : "";
          log(
            `  ${kleur.cyan(op.toolName)}  ${tag}${kleur.dim(
              op.method.toUpperCase() + " " + op.path
            )}`
          );
          if (op.summary) log(`    ${op.summary}`);
        }
      }
    )
    .command(
      "generate <spec> <out>",
      "Emit a standalone, hand-editable MCP server project",
      (y) =>
        y
          .positional("spec", {
            describe: "Path or URL to an OpenAPI spec",
            type: "string",
          })
          .positional("out", {
            describe: "Output directory",
            type: "string",
          })
          .option("name", {
            type: "string",
            describe: "Package name for the generated project",
          })
          .option("base-url", {
            type: "string",
            describe: "Hardcode a base URL into the generated server",
          })
          .option("curl", { type: "string" }),
      async (argv) => {
        const spec = await loadSpec(argv);
        const out = resolve(process.cwd(), argv.out as string);
        const result = await generateProject(spec, out, {
          name: argv.name,
          baseUrl: argv["base-url"] as string | undefined,
        });
        log(
          kleur.green("✓") +
            ` Generated ${result.files.length} files in ${kleur.cyan(out)}`
        );
        log("");
        log(kleur.dim("  Next:"));
        log(kleur.dim(`    cd ${out}`));
        log(kleur.dim("    npm install && npm run build && npm start"));
      }
    )
    .demandCommand(1)
    .strict()
    .help()
    .version()
    .fail((msg, err) => {
      if (err) {
        log(kleur.red("Error: ") + err.message);
      } else {
        log(kleur.red("Error: ") + msg);
      }
      process.exit(1);
    })
    .parseAsync();
}

async function loadSpec(argv: any): Promise<ApiSpec> {
  if (argv.curl) {
    const curlText = await resolveCurlInput(argv.curl);
    return parseCurl(curlText);
  }
  const input = argv.spec as string;
  if (!input) throw new Error("Missing required positional: <spec>");
  // Treat input as curl if it begins with `curl ` (handy shortcut).
  if (/^\s*curl\s/i.test(input)) {
    return parseCurl(input);
  }
  const raw = await loadOpenApiSpec(input);
  return parseOpenApi(raw);
}

async function resolveCurlInput(value: string): Promise<string> {
  // If `--curl` looks like a path to a file, read it; otherwise treat as inline.
  if (
    !value.trim().toLowerCase().startsWith("curl") &&
    !value.includes("\n") &&
    value.length < 260
  ) {
    try {
      return await readFile(resolve(process.cwd(), value), "utf-8");
    } catch {
      // Fall through to inline.
    }
  }
  return value;
}

function optsFromArgs(argv: any) {
  const headers: Record<string, string> = {};
  for (const h of (argv.header as string[] | undefined) || []) {
    const idx = h.indexOf(":");
    if (idx > 0) {
      headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
    }
  }
  return {
    baseUrl: argv["base-url"] as string | undefined,
    filterTag: argv.tag as string | undefined,
    filterPattern: argv.filter ? new RegExp(argv.filter as string) : undefined,
    maxTools: argv["max-tools"] as number | undefined,
    extraHeaders: headers,
  };
}

function applyFilters(ops: any[], opts: any) {
  let out = ops;
  if (opts.filterTag) {
    const tag = opts.filterTag.toLowerCase();
    out = out.filter((o: any) =>
      o.tags.some((t: string) => t.toLowerCase() === tag)
    );
  }
  if (opts.filterPattern) {
    out = out.filter((o: any) => opts.filterPattern.test(o.toolName));
  }
  return out;
}

main().catch((err) => {
  log(kleur.red("Fatal: ") + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
