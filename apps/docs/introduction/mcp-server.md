---
description: Connect AI agents to Applesauce documentation and examples using the MCP server
---

# MCP Server

The Applesauce MCP (Model Context Protocol) server helps AI agents build Nostr applications by providing semantic search over Applesauce documentation and code examples. By integrating this into your AI-powered IDE or coding assistant, your agent gains instant access to comprehensive documentation, real-world examples, and best practices.

## Why Use the MCP Server?

- **Reduce hallucinations** - AI agents can verify API usage against actual documentation
- **Faster development** - Find relevant examples and patterns through natural language queries
- **Stay current** - Access up-to-date documentation and examples
- **Better code quality** - Learn from real-world usage patterns

## Quick Start

The easiest way to use the MCP server is through the public HTTP endpoint:

```
https://mcp.applesauce.build/mcp
```

No installation required! Just configure your IDE to connect to this endpoint.

If you want to test out the tool manually you can run this command:

```bash
npx @modelcontextprotocol/inspector --server-url https://mcp.applesauce.build/mcp
```

## IDE Integration

Configure the MCP server for your preferred IDE:

:::code-group

```json [OpenCode]
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "applesauce": {
      "type": "remote",
      "url": "https://mcp.applesauce.build/mcp"
    }
  }
}
```

```json [Cursor]
// .cursor/mcp.json (project) or ~/.cursor/mcp.json (global)
{
  "mcpServers": {
    "applesauce": {
      "url": "https://mcp.applesauce.build/mcp"
    }
  }
}
```

```json [Claude Desktop]
// ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
// %APPDATA%\Claude\claude_desktop_config.json (Windows)
// ~/.config/Claude/claude_desktop_config.json (Linux)
{
  "mcpServers": {
    "applesauce": {
      "url": "https://mcp.applesauce.build/mcp"
    }
  }
}
```

```json [Cline / Other]
// Configuration location varies by IDE
{
  "mcpServers": {
    "applesauce": {
      "url": "https://mcp.applesauce.build/mcp"
    }
  }
}
```

:::

**Resources:**

- [MCP in OpenCode](https://opencode.ai/docs/mcp-servers/)
- [MCP in Cursor](https://cursor.com/docs/context/mcp)

## Recommended: Install Nostrbook MCP

For comprehensive Nostr protocol knowledge, we recommend also installing the [Nostrbook MCP server](https://nostrbook.dev/mcp). While Applesauce MCP provides documentation and examples for building with Applesauce, Nostrbook MCP gives agents direct access to NIPs, event kinds, tags, and protocol documentation.

**Benefits of using both:**

- **Protocol reference** - Query NIPs and protocol specifications directly
- **Event kind details** - Get up-to-date information about any Nostr event kind
- **Tag documentation** - Understand how to use specific tags
- **Complementary coverage** - Applesauce shows _how to build_, Nostrbook explains _what to build_

Add Nostrbook MCP alongside Applesauce in your configuration:

:::code-group

```json [OpenCode]
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "applesauce": {
      "type": "remote",
      "url": "https://mcp.applesauce.build/mcp"
    },
    "nostr": {
      "type": "command",
      "command": "npx",
      "args": ["-y", "@nostrbook/mcp@latest"]
    }
  }
}
```

```json [Cursor]
// .cursor/mcp.json (project) or ~/.cursor/mcp.json (global)
{
  "mcpServers": {
    "applesauce": {
      "url": "https://mcp.applesauce.build/mcp"
    },
    "nostr": {
      "command": "npx",
      "args": ["-y", "@nostrbook/mcp@latest"]
    }
  }
}
```

```json [Claude Desktop]
// ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
// %APPDATA%\Claude\claude_desktop_config.json (Windows)
// ~/.config/Claude/claude_desktop_config.json (Linux)
{
  "mcpServers": {
    "applesauce": {
      "url": "https://mcp.applesauce.build/mcp"
    },
    "nostr": {
      "command": "npx",
      "args": ["-y", "@nostrbook/mcp@latest"]
    }
  }
}
```

```json [Cline / Other]
// Configuration location varies by IDE
{
  "mcpServers": {
    "applesauce": {
      "url": "https://mcp.applesauce.build/mcp"
    },
    "nostr": {
      "command": "npx",
      "args": ["-y", "@nostrbook/mcp@latest"]
    }
  }
}
```

:::

See [nostrbook.dev/mcp](https://nostrbook.dev/mcp) for full installation instructions and available tools.

## Available Tools

Once configured, AI agents can use these tools:

### Documentation Tools

- **`search_docs`** - Semantic search through Applesauce documentation
- **`list_docs`** - List all available documentation files
- **`read_docs`** - Read full content of specific documentation files

### Example Code Tools

- **`search_examples`** - Search real-world code examples
- **`list_examples`** - List all available examples
- **`read_example`** - Read full source code and metadata for examples

## Running Locally

For advanced users who want to run the MCP server locally:

:::code-group

```json [Deno (JSR)]
{
  "mcpServers": {
    "applesauce": {
      "command": "deno",
      "args": ["run", "-P", "jsr:@applesauce/mcp"]
    }
  }
}
```

```bash [Docker]
# Using Docker Compose
docker-compose up -d

# Or build and run directly
docker build -t applesauce-mcp .
docker run -p 3000:3000 applesauce-mcp
```

:::

**Prerequisites for Deno:**

- [Deno](https://deno.land) installed
- [Ollama](https://ollama.ai) running locally for embeddings

### Custom Embedding Providers

The server supports multiple embedding providers (Ollama, OpenAI, OpenRouter, etc.). Configure using environment variables:

```bash
# Using OpenAI
export EMBEDDING_PROVIDER=openai
export EMBEDDING_MODEL=text-embedding-3-small
export OPENAI_API_KEY=sk-your-api-key

# Using OpenRouter
export EMBEDDING_PROVIDER=openai
export EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v1.5
export OPENAI_API_KEY=sk-or-v1-your-api-key
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

## Source Code

The MCP server is open source and available on GitHub:

- **Repository:** [github.com/hzrd149/applesauce-mcp](https://github.com/hzrd149/applesauce-mcp)
- **JSR Package:** [@applesauce/mcp](https://jsr.io/@applesauce/mcp)
- **License:** MIT
