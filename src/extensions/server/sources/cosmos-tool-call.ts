import type { EnrichSpanInput, SpanEnrichment } from '../../types'
import { getContainer } from '../cosmos-client'

/**
 * Cosmos DB source — fetches the full untruncated arguments + result for a
 * single tool call. App Insights caps `gen_ai.tool.call.{arguments,result}`
 * at 8192 chars; the authoritative payload lives in the `messages` container
 * (FunctionCallContent / FunctionResultContent items keyed by CallId).
 *
 * Returns null when not configured, not a tool span, missing callId/threadId,
 * or the call isn't found in Cosmos.
 */
export async function cosmosToolCall(input: EnrichSpanInput): Promise<SpanEnrichment | null> {
  if (input.operation !== 'tool' && input.operation !== 'mcp') return null
  const threadId = input.sessionId
  const callId = input.toolCallId
  if (!threadId || !callId) return null

  const container = getContainer('messages')
  if (!container) return null

  try {
    // Single-partition queries (~2-3 RU each): conversationId = threadId.
    // Fetch both arguments (assistant role, functionCall) and result (tool
    // role, functionResult) for this callId. Run in parallel.
    const [callRes, resultRes] = await Promise.all([
      container.items
        .query<{ message: string }>({
          query: `SELECT c.message FROM c
            WHERE c.conversationId = @threadId
              AND c.type = "ChatMessage" AND c.role = "assistant"
              AND CONTAINS(c.message, @callId)`,
          parameters: [
            { name: '@threadId', value: threadId },
            { name: '@callId', value: callId },
          ],
        })
        .fetchAll(),
      container.items
        .query<{ message: string }>({
          query: `SELECT c.message FROM c
            WHERE c.conversationId = @threadId
              AND c.type = "ChatMessage" AND c.role = "tool"
              AND CONTAINS(c.message, @callId)`,
          parameters: [
            { name: '@threadId', value: threadId },
            { name: '@callId', value: callId },
          ],
        })
        .fetchAll(),
    ])

    const toolInput = extractCallArguments(callRes.resources, callId)
    const toolResult = extractCallResult(resultRes.resources, callId)

    const enrichment: SpanEnrichment = {}
    if (toolInput) enrichment.toolInput = toolInput
    if (toolResult) enrichment.toolResult = toolResult
    return Object.keys(enrichment).length > 0 ? enrichment : null
  } catch (e) {
    console.error('[extensions/cosmos-tool-call]', e)
    return null
  }
}

function extractCallArguments(docs: { message: string }[], callId: string): string | undefined {
  for (const doc of docs) {
    const msg = safeParse(doc.message)
    if (!msg) continue
    for (const item of contentsOf(msg)) {
      const c = item as { $type?: string; CallId?: string; callId?: string; Arguments?: unknown; arguments?: unknown }
      if (c.$type !== 'functionCall') continue
      const id = c.CallId ?? c.callId
      if (id !== callId) continue
      const args = c.Arguments ?? c.arguments
      if (args == null) return undefined
      return typeof args === 'string' ? args : JSON.stringify(args)
    }
  }
  return undefined
}

function extractCallResult(docs: { message: string }[], callId: string): string | undefined {
  for (const doc of docs) {
    const msg = safeParse(doc.message)
    if (!msg) continue
    for (const item of contentsOf(msg)) {
      const r = item as { $type?: string; CallId?: string; callId?: string; Result?: unknown; result?: unknown }
      if (r.$type !== 'functionResult') continue
      const id = r.CallId ?? r.callId
      if (id !== callId) continue
      const result = r.Result ?? r.result
      if (result == null) return undefined
      return typeof result === 'string' ? result : JSON.stringify(result)
    }
  }
  return undefined
}

function safeParse(text: string): { Contents?: unknown[]; contents?: unknown[] } | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function contentsOf(msg: { Contents?: unknown[]; contents?: unknown[] }): unknown[] {
  return (msg.Contents ?? msg.contents ?? []) as unknown[]
}
