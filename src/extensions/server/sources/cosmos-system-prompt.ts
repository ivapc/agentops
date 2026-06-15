import type { EnrichSpanInput, SpanEnrichment } from '../../types'
import { queryMessages } from '../cosmos-client'

/**
 * Cosmos DB source — fetches the full untruncated system prompt for an
 * invoke_agent span. App Insights truncates `gen_ai.system_instructions`
 * (via customDimensions) at 8192 chars; the full content lives in the
 * messages container as a role="system" ChatMessage.
 *
 * Returns null when not configured, not an invoke_agent span, or no
 * system message is found.
 */
export async function cosmosSystemPrompt(input: EnrichSpanInput): Promise<SpanEnrichment | null> {
  if (input.operation !== 'invoke_agent') return null
  const threadId = input.sessionId
  if (!threadId) return null

  try {
    const resources = await queryMessages<{ message: string }>({
      query: `SELECT c.message FROM c
        WHERE c.conversationId = @threadId
          AND c.type = "ChatMessage" AND c.role = "system"
        ORDER BY c.timestamp ASC
        OFFSET 0 LIMIT 1`,
      parameters: [{ name: '@threadId', value: threadId }],
    })

    if (resources.length === 0) return null

    const content = resources[0].message
    if (!content || typeof content !== 'string') return null

    // MAF SDK format: {"Role":"system","Contents":[{"$type":"text","Text":"..."}]}
    // Fall back to treating the whole field as a plain string if parsing fails.
    const parsed = safeParse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      const contents = obj['Contents']
      if (Array.isArray(contents)) {
        const parts: string[] = []
        for (const item of contents) {
          if (item && typeof item === 'object') {
            const t = item as Record<string, unknown>
            // $type:"text" with Text field (MAF SDK)
            if (t['$type'] === 'text' && typeof t['Text'] === 'string' && t['Text']) {
              parts.push(t['Text'] as string)
            }
          }
        }
        const joined = parts.join('\n\n').trim()
        if (joined) return { systemInstructions: joined }
      }
    }

    const trimmed = content.trim()
    return trimmed ? { systemInstructions: trimmed } : null
  } catch (e) {
    console.error('[extensions/cosmos-system-prompt] query failed:', e)
    return null
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
