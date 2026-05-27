import { useQuery } from '@tanstack/react-query'
import type { Span } from '#/lib/spans'
import { enrichSpan } from '../server/enrich-span'
import type { SpanEnrichment } from '../types'

/**
 * Fetches enrichment data for a chat span from fork-local sources (Cosmos, SQL).
 * Self-contained: internally decides whether to fetch based on span type.
 * Returns undefined when not applicable; callers just prefer enriched values.
 */
export function useSpanEnrichment(span: Span | undefined) {
  const isChat = !!span && span.operation === 'chat'
  const isToolCall = !!span && (span.operation === 'tool' || span.operation === 'mcp') && !!span.toolCallId
  const shouldFetch = isChat || isToolCall

  return useQuery<SpanEnrichment | null>({
    queryKey: ['extensions', 'enrich-span', span?.id],
    queryFn: () => {
      if (!span) return null
      return enrichSpan({
        data: {
          spanId: span.id,
          traceId: span.traceId,
          sessionId: span.sessionId,
          operation: span.operation,
          toolCallId: span.toolCallId,
          model: span.model,
          agentName: span.agentName,
        },
      })
    },
    enabled: shouldFetch,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}
