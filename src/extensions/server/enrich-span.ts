import { createServerFn } from '@tanstack/react-start'
import type { EnrichSpanInput, SpanEnrichment } from '../types'
import { cosmosMessages } from './sources/cosmos-messages'
import { cosmosToolCall } from './sources/cosmos-tool-call'
import { cosmosToolDefinitions } from './sources/cosmos-tool-definitions'

/**
 * Dispatcher: routes enrichment requests to configured sources.
 * Each source returns SpanEnrichment | null. First non-null wins.
 * Returns null when no sources are configured (safe no-op for upstream).
 */
export const enrichSpan = createServerFn({ method: 'POST' })
  .inputValidator((input: EnrichSpanInput) => input)
  .handler(async ({ data }): Promise<SpanEnrichment | null> => {
    // Add sources here as they become available.
    // Order = priority: first non-null result wins. Each source is responsible
    // for filtering by `data.operation` so unrelated calls early-exit cheaply.
    const sources = [cosmosMessages, cosmosToolCall, cosmosToolDefinitions]

    for (const source of sources) {
      try {
        const result = await source(data)
        if (result) return result
      } catch (e) {
        console.error(`[extensions/enrich-span] source failed:`, e)
      }
    }

    return null
  })
