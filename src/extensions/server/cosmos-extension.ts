import type { EnrichSpanRequest, Extension } from '#/lib/extension-registry'
import { isConfigured } from './cosmos-client'
import { cosmosMessages } from './sources/cosmos-messages'
import { cosmosSystemPrompt } from './sources/cosmos-system-prompt'
import { cosmosToolDefinitions } from './sources/cosmos-tool-definitions'
import { cosmosToolPayloads } from './sources/cosmos-tool-payloads'

export const cosmosExtension: Extension = {
  name: 'cosmos',

  async resolveTruncatedAttr(req: EnrichSpanRequest) {
    if (!isConfigured()) return null
    // sessionId === traceId means the trace-id fallback (no thread attr on the
    // span), which can't correlate to a Cosmos conversationId.
    if (!req.sessionId || req.sessionId === req.traceId) return null

    const base = { spanId: req.spanId, traceId: req.traceId, sessionId: req.sessionId }
    switch (req.field) {
      case 'llmInput':
        return (await cosmosMessages({ ...base, operation: 'chat' }))?.llmInput ?? null
      case 'llmOutput':
        return (await cosmosMessages({ ...base, operation: 'chat' }))?.llmOutput ?? null
      case 'systemInstructions':
        return (await cosmosSystemPrompt({ ...base, operation: 'invoke_agent' }))?.systemInstructions ?? null
      case 'toolDefinitions':
        return (await cosmosToolDefinitions({ ...base, operation: req.operation }))?.toolDefinitions ?? null
      default:
        return null
    }
  },

  toolPayloadSizes: cosmosToolPayloads,
}
