import { useMemo } from 'react'
import type { Span } from '#/lib/spans'
import { useSpanEnrichment } from './use-span-enrichment'

// App Insights caps attributes at 8192 chars. Stay well under to detect truncation.
const TRUNCATION_THRESHOLD = 7800

/**
 * Detects whether a span's tool definitions are likely truncated.
 */
function isToolDefinitionsTruncated(span: Span): boolean {
  if (!span.toolDefinitions) return false
  const text = typeof span.toolDefinitions === 'string' ? span.toolDefinitions : JSON.stringify(span.toolDefinitions)
  return text.length >= TRUNCATION_THRESHOLD
}

/**
 * Fork-local hook that enriches spans with full tool definitions from Cosmos
 * when App Insights has truncated them.
 *
 * Fetches one truncated span at a time (Rules of Hooks). Once enriched, the
 * patched span array changes, triggering re-render, and the next truncated
 * span becomes the fetch target.
 *
 * Returns the same `spans` array (by reference) when no enrichment is needed,
 * so downstream memoization works correctly.
 */
export function useToolDefinitionsEnrichment(spans: Span[]): {
  spans: Span[]
  isLoading: boolean
} {
  // Find spans with truncated tool definitions (chat/invoke_agent only).
  const truncatedSpans = useMemo(
    () =>
      spans.filter((s) => (s.operation === 'chat' || s.operation === 'invoke_agent') && isToolDefinitionsTruncated(s)),
    [spans],
  )

  // Fetch enrichment for the first truncated span (one at a time for Rules of Hooks).
  const truncatedToFetch = truncatedSpans[0]
  const { data: enrichment, isPending } = useSpanEnrichment(truncatedToFetch)

  // Patch the first span with enriched definitions if available.
  // Re-render will then target the next truncated span.
  const patchedSpans = useMemo(() => {
    if (!truncatedToFetch || isPending || !enrichment?.toolDefinitions) return spans
    return spans.map((s) => (s.id === truncatedToFetch.id ? { ...s, toolDefinitions: enrichment.toolDefinitions } : s))
  }, [spans, truncatedToFetch, enrichment, isPending])

  return {
    spans: patchedSpans,
    isLoading: truncatedSpans.length > 0 && isPending,
  }
}
