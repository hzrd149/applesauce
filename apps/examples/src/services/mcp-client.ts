import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { APPLESAUCE_MCP_SERVER } from "../const";

// Cached client instance
let cachedClient: Client | null = null;
let connecting: Promise<Client> | null = null;

/**
 * Get or create MCP client connected to APPLESAUCE_MCP_SERVER
 * The client is created on demand and cached for subsequent calls
 */
export async function getMCPClient(): Promise<Client | null> {
  // Return cached client if available
  if (cachedClient) return cachedClient;

  // Return in-progress connection
  if (connecting) return connecting;

  // Check if MCP server URL is configured
  const serverUrl = APPLESAUCE_MCP_SERVER;
  if (!serverUrl) {
    console.log("MCP server not configured. Set VITE_APPLESAUCE_MCP_SERVER environment variable.");
    return null;
  }

  // Start connection
  connecting = (async () => {
    try {
      const transport = new StreamableHTTPClientTransport(new URL(serverUrl));

      const client = new Client(
        {
          name: "applesauce-examples",
          version: "1.0.0",
        },
        {
          capabilities: {},
        },
      );

      console.log("Connecting to MCP server:", serverUrl);
      await client.connect(transport);
      cachedClient = client;

      const tools = await client.listTools();
      console.log("Connected to MCP server:", tools);
      return client;
    } catch (error) {
      console.error("Failed to connect to MCP server:", error);
      throw error;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}
