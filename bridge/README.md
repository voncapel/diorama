# @diorama/bridge

Local MCP (Model Context Protocol) server exposing the Diorama Chrome extension to AI agents.

## Installation

```bash
cd bridge
npm install
npm run build
```

## Running the Server

```bash
# Start standalone
node dist/cli.js

# Or with custom port
node dist/cli.js --port 47831
```

## Agent / MCP Configuration

Configure the MCP server in your agent configuration (Claude Code, Codex, Cursor, DeepSeek Harness, etc.):

```json
{
  "mcpServers": {
    "diorama": {
      "command": "node",
      "args": ["/Users/tristanchapelle/Documents/Code/diorama/bridge/dist/cli.js"],
      "env": {
        "DIORAMA_OUTPUT_DIR": "/Users/tristanchapelle/Diorama/exports"
      }
    }
  }
}
```

## Environment Variables

- `DIORAMA_BRIDGE_PORT`: WebSocket port for extension connections (default: `47831`).
- `DIORAMA_OUTPUT_DIR`: Target directory where exported MP4 video files are written (default: `~/Diorama/exports`).
