import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp'
import type { JsonValue } from '#/lib/json'
import type { McpServerRef, McpTool } from './types'

const REQUEST_TIMEOUT_MS = 10_000

export async function listServerTools(ref: McpServerRef): Promise<McpTool[]> {
  if (!ref.endpoint) return []
  if (ref.transport !== 'streamable-http' && ref.transport !== 'unknown') return []

  const client = new Client({ name: 'loupe', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(ref.endpoint))

  try {
    await client.connect(transport)
    const result = await client.listTools(undefined, { timeout: REQUEST_TIMEOUT_MS })

    return (result.tools ?? []).map((tool) => ({
      id: `${ref.id}:${tool.name}`,
      serverId: ref.id,
      serverName: ref.name,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as JsonValue | undefined,
    }))
  } finally {
    await client.close().catch(() => {})
  }
}
