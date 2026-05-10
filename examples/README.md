# Examples

Drop-in specs for trying `unmcp` in 30 seconds.

## JSONPlaceholder (no auth — start here)

```bash
npx unmcp examples/jsonplaceholder.json
```

A real, public REST API that requires no credentials. Best first run.

## Petstore

```bash
npx unmcp examples/petstore.json
```

The classic. Includes path params, query params, and a JSON request body.

## Curl shortcut

```bash
npx unmcp --curl "curl -H 'Authorization: Bearer xxx' https://api.github.com/user/repos"
```

Turns a single curl command into a one-tool MCP server.

## Use with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jsonplaceholder": {
      "command": "npx",
      "args": ["-y", "unmcp", "/absolute/path/to/jsonplaceholder.json"]
    }
  }
}
```
