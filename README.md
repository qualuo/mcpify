<div align="center">

# unmcp

### Turn any API into an MCP server. One command. No code.

[![npm](https://img.shields.io/npm/v/unmcp?color=cb3837)](https://www.npmjs.com/package/unmcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/unmcp/unmcp/ci.yml?branch=main)](https://github.com/unmcp/unmcp/actions)

</div>

```bash
npx unmcp https://petstore3.swagger.io/api/v3/openapi.json
```

```
✓ unmcp: Petstore v1.0.0 — 19 tools
  base: https://petstore3.swagger.io/api/v3
  transport: stdio
```

That's it. Your AI agent now has access to the entire Petstore API. No SDK to install. No glue code to write. No server to deploy.

**Point it at any OpenAPI spec → get a fully working MCP server.**

---

## Why

Every team building agents hits the same wall: the model needs to call APIs, and wiring up each one means days of bespoke MCP server code, schema translation, and auth plumbing.

`unmcp` collapses that to one command. The OpenAPI spec already describes everything — endpoints, parameters, schemas, auth. We turn it into an MCP server at runtime, no codegen step, no source files to maintain.

## Install

Use it on demand with `npx` (recommended):

```bash
npx unmcp <spec>
```

Or install globally:

```bash
npm install -g unmcp
```

Requires Node.js 18+.

## Use

### From a hosted spec

```bash
npx unmcp https://api.example.com/openapi.json
```

### From a local file (JSON or YAML)

```bash
npx unmcp ./spec.yaml
```

### From a single curl command

```bash
npx unmcp --curl "curl -H 'Authorization: Bearer xxx' https://api.github.com/user/repos"
```

Generates a one-tool MCP server from any curl command. Body is parsed and turned into an input schema.

### List tools without serving

```bash
npx unmcp list ./spec.json
```

### Generate a standalone, hand-editable project

```bash
npx unmcp generate ./spec.json ./my-mcp
cd my-mcp && npm install && npm start
```

Use this when you want to fork the behavior — add caching, custom auth flows, post-processing, anything.

## Auth

Set environment variables before launching. `unmcp` reads the spec's `securitySchemes` and matches them automatically.

```bash
# HTTP bearer schemes
export UNMCP_BEARER_TOKEN=xxx

# apiKey schemes (header or query, as the spec says)
export UNMCP_API_KEY=xxx

# HTTP basic
export UNMCP_BASIC_AUTH=user:password

# Per-scheme override (use the scheme's name from the spec)
export UNMCP_AUTH_<SCHEME_NAME>=xxx

# Free-form extra headers on every request
export UNMCP_HEADERS='{"X-Trace-Id":"abc","X-Internal":"1"}'
```

## Filter big specs

Stripe's full OpenAPI is ~600 endpoints. Most agents do not need all of them, and most clients won't tolerate that many tools. Trim:

```bash
# Only the customers tag
npx unmcp ./stripe.json --tag customers

# Only operations whose tool name matches a regex
npx unmcp ./stripe.json --filter "^createCustomer|^getCustomer"

# Hard cap
npx unmcp ./stripe.json --max-tools 30
```

## Use with Claude Desktop

`~/.config/claude/claude_desktop_config.json` (Linux/macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "petstore": {
      "command": "npx",
      "args": ["-y", "unmcp", "https://petstore3.swagger.io/api/v3/openapi.json"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "unmcp", "--curl",
        "curl -H 'Authorization: Bearer ghp_xxx' https://api.github.com/user/repos"]
    }
  }
}
```

## Use with Cursor / Cline / Claude Code

Same idea — anywhere you can configure an MCP server with a `command` and `args`, this works. `unmcp` speaks stdio.

```bash
# Claude Code:
claude mcp add petstore -- npx -y unmcp https://petstore3.swagger.io/api/v3/openapi.json
```

## Programmatic API

```ts
import { loadOpenApiSpec, parseOpenApi, serve } from "unmcp";

const raw = await loadOpenApiSpec("./spec.yaml");
const spec = parseOpenApi(raw);
await serve(spec, {
  baseUrl: "https://staging.example.com",
  filterTag: "users",
});
```

## How it works

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   OpenAPI spec  │ ─→ │  unmcp runtime  │ ─→ │   MCP client    │
│  (JSON / YAML)  │    │  (stdio server) │    │ (Claude/Cursor) │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                            │
                            ↓ tool call
                       ┌─────────┐
                       │  fetch  │ → your API
                       └─────────┘
```

1. Dereference the spec (resolve `$ref`s).
2. Convert each operation into an MCP tool: path/query/header params become input properties; the request body becomes a nested `body` property.
3. On a tool call, build the URL, attach auth from env, send the request, return the response.

No codegen. No restart loop. The spec is the source of truth.

## Limitations

- **Streaming response bodies** — currently buffered, capped at 64KB.
- **OAuth2 flows** — not run automatically; supply a pre-fetched token via `UNMCP_BEARER_TOKEN`.
- **File uploads (`multipart/form-data`)** — not yet supported.
- **Webhooks / callbacks** — out of scope.
- **Swagger 2.0** — partial; convert to OpenAPI 3 first for best results.

PRs welcome on all of the above.

## Development

```bash
git clone https://github.com/unmcp/unmcp
cd unmcp
npm install
npm run build
npm test
```

## License

MIT
