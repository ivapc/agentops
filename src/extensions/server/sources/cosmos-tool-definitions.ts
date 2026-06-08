import type { JsonValue } from '#/lib/json'
import type { EnrichSpanInput, SpanEnrichment } from '../../types'
import { queryMessages } from '../cosmos-client'

/**
 * Cosmos DB source — fetches the full untruncated tool definitions for a chat
 * or invoke_agent span. App Insights caps `gen_ai.tool.definitions` at 8192
 * chars; the authoritative list lives in Cosmos (the MAF SDK stores the
 * full definitions used to construct the API call).
 *
 * Queries the messages container for the span's corresponding MAF internal
 * state or agent initialization to recover tool definitions.
 *
 * Returns null when not configured, not a chat/invoke_agent span, no
 * sessionId, or definitions not found.
 */
export async function cosmosToolDefinitions(input: EnrichSpanInput): Promise<SpanEnrichment | null> {
  if (input.operation !== 'chat' && input.operation !== 'invoke_agent') return null
  const threadId = input.sessionId
  if (!threadId) return null

  try {
    // Fetch assistant messages to find function definitions in the thread.
    // The definitions appear in message.Contents[].Functions or similar
    // depending on the MAF SDK version.
    const docs = await queryMessages<{ message: string; timestamp: number }>({
      query: `SELECT c.message, c.timestamp FROM c
        WHERE c.conversationId = @threadId
          AND c.type = "ChatMessage"
          AND c.role = "assistant"
          AND CONTAINS(c.message, "functions")
        ORDER BY c.timestamp DESC`,
      parameters: [{ name: '@threadId', value: threadId }],
    })

    if (docs.length === 0) return null

    // Parse and extract tool definitions from the most recent message.
    for (const doc of docs) {
      const defs = extractToolDefinitions(doc.message)
      if (Array.isArray(defs) && defs.length > 0) {
        return { toolDefinitions: defs }
      }
    }

    return null
  } catch (e) {
    console.error('[extensions/cosmos-tool-definitions]', e)
    return null
  }
}

function extractToolDefinitions(messageJson: string): JsonValue | null {
  try {
    const msg = JSON.parse(messageJson)

    // Try different shapes: Contents, contents, functions, Functions
    let contents: unknown[] | null = null
    if (Array.isArray(msg.Contents)) contents = msg.Contents
    else if (Array.isArray(msg.contents)) contents = msg.contents

    if (!contents) return null

    // Look for function definitions in Contents items
    for (const item of contents) {
      const itemObj = item as Record<string, unknown>
      if (itemObj.$type === 'functionDefinitions') {
        const funcs = itemObj.Functions ?? itemObj.functions
        if (Array.isArray(funcs)) return funcs
      } else if (Array.isArray(itemObj.Functions)) {
        return itemObj.Functions
      } else if (Array.isArray(itemObj.functions)) {
        return itemObj.functions
      }
    }

    // Fallback: if the entire message is a tool definitions object
    if (msg.Functions && Array.isArray(msg.Functions)) return msg.Functions
    if (msg.functions && Array.isArray(msg.functions)) return msg.functions

    return null
  } catch {
    return null
  }
}
