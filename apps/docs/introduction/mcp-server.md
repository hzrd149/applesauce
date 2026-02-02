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

### OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
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

[Learn more about MCP in OpenCode](https://opencode.ai/docs/mcp-servers/)

### Cursor

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en-US/install-mcp?name=applesauce&config=eyJ1cmwiOiJodHRwczovL21jcC5hcHBsZXNhdWNlLmJ1aWxkL21jcCJ9)

```json
{
  "mcpServers": {
    "applesauce": {
      "url": "https://mcp.applesauce.build/mcp"
    }
  }
}
```

[Learn more about MCP in Cursor](https://cursor.com/docs/context/mcp)

### Claude Desktop & Other IDEs

For Claude Desktop, Cline, and other MCP-compatible tools:

```json
{
  "mcpServers": {
    "applesauce": {
      "url": "https://mcp.applesauce.build/mcp"
    }
  }
}
```

Refer to your IDE's documentation for the specific configuration file location.

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

### Using Deno and JSR

```json
{
  "mcpServers": {
    "applesauce": {
      "command": "deno",
      "args": ["run", "-P", "jsr:@applesauce/mcp"]
    }
  }
}
```

**Prerequisites:**

- [Deno](https://deno.land) installed
- [Ollama](https://ollama.ai) running locally for embeddings

### Using Docker

```bash
# Using Docker Compose
docker-compose up -d

# Or build and run directly
docker build -t applesauce-mcp .
docker run -p 3000:3000 applesauce-mcp
```

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
