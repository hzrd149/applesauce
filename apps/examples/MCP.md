# MCP Integration

The examples app supports enhanced search functionality using the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

## Setup

1. **Configure the MCP server URL**

   Create a `.env` file in `apps/examples/`:

   ```bash
   VITE_APPLESAUCE_MCP_SERVER=http://localhost:3000/mcp
   ```

2. **Start your MCP server**

   Your MCP server should implement the following tools:
   - `search_examples` - Searches examples by query
     - Input: `{ query: string }`
     - Output: `{ results: Array<{ id: string, name: string, description?: string, tags?: string[], score?: number }> }`

   - `list_examples` (optional) - Lists all examples
     - Output: `{ examples: Array<{ id: string, name: string, description?: string, tags?: string[] }> }`

3. **Run the examples app**

   ```bash
   npm run dev
   ```

   The app will automatically connect to the MCP server on startup. If the server is not available, the app will fall back to local search.

## Usage

Once connected to an MCP server:

1. A cube icon button appears next to the search bar
2. Click the button to toggle between local search and MCP search
3. When MCP search is active, the button turns blue and results are fetched from the MCP server
4. Search results from MCP can include relevance scores

## Architecture

- **`src/services/mcp-client.ts`** - Creates and caches a single MCP client connected to `VITE_APPLESAUCE_MCP_SERVER`
- **`src/hooks/use-mcp.ts`** - React hook for accessing the MCP client
- **`src/routes/landing.tsx`** - Landing page with integrated MCP search

The MCP client is created on demand and cached for the lifetime of the app. It uses the Streamable HTTP transport for remote server communication.

## Example MCP Server

Here's a minimal example of an MCP server that implements `search_examples`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const server = new McpServer({
  name: "applesauce-examples-server",
  version: "1.0.0",
});

// Register search_examples tool
server.setRequestHandler("tools/call", async (request) => {
  if (request.params.name === "search_examples") {
    const query = request.params.arguments?.query as string;

    // Implement your search logic here
    const results = searchExamples(query);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ results }),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

// Start server on port 3000
const transport = new StreamableHTTPServerTransport({
  endpoint: "/mcp",
  port: 3000,
});

await server.connect(transport);
```

See the [MCP TypeScript SDK documentation](https://github.com/modelcontextprotocol/typescript-sdk) for more details.
