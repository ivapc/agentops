import type { EnrichSpanInput, SpanEnrichment } from '../../types'
import { queryMessages } from '../cosmos-client'

/**
 * Cosmos DB source — queries the messages container for full LLM message
 * payloads that App Insights truncates at 8192 chars.
 *
 * Returns null when not configured or document not found.
 */
export async function cosmosMessages(input: EnrichSpanInput): Promise<SpanEnrichment | null> {
  if (input.operation !== undefined && input.operation !== 'chat') return null

  // conversationId in Cosmos is the Teams thread ID (ag_ui.thread_id),
  // which agentops surfaces as span.sessionId.
  const threadId = input.sessionId
  if (!threadId) {
    console.warn('[extensions/cosmos-messages] no sessionId on span, cannot correlate')
    return null
  }

  const query = `
    SELECT TOP 20 c.role, c.message, c.timestamp
    FROM c
    WHERE c.conversationId = @threadId
      AND c.type = "ChatMessage"
    ORDER BY c.timestamp ASC
  `

  try {
    const resources = await queryMessages<Record<string, unknown>>({
      query,
      parameters: [{ name: '@threadId', value: threadId }],
    })

    if (resources.length === 0) return null

    // Reconstruct LLM input messages from conversation history
    const inputMessages = resources
      .filter((r: Record<string, unknown>) => r.role !== 'assistant')
      .map((r: Record<string, unknown>) => ({
        role: r.role as string,
        content: r.message as string,
      }))

    const outputMessages = resources
      .filter((r: Record<string, unknown>) => r.role === 'assistant')
      .map((r: Record<string, unknown>) => ({
        role: 'assistant',
        content: r.message as string,
      }))

    const enrichment: SpanEnrichment = {}
    if (inputMessages.length > 0) enrichment.llmInput = inputMessages
    if (outputMessages.length > 0) enrichment.llmOutput = outputMessages

    return Object.keys(enrichment).length > 0 ? enrichment : null
  } catch (e) {
    console.error('[extensions/cosmos-messages] query failed:', e)
    return null
  }
}
