import type { JsonValue } from '#/lib/json'

/**
 * Data returned by the span enrichment adapter. Each field is optional —
 * only populated fields override the telemetry-provider data.
 */
export interface SpanEnrichment {
  /** Full LLM input messages (bypasses App Insights 8192-char truncation). */
  llmInput?: JsonValue
  /** Full LLM output messages. */
  llmOutput?: JsonValue
  /** Full tool call arguments (raw JSON string, untruncated). */
  toolInput?: string
  /** Full tool call result (raw JSON string, untruncated). */
  toolResult?: string
  /** Full tool definitions array (untruncated). */
  toolDefinitions?: JsonValue
  /** Arbitrary metadata from external sources (Cosmos, SQL, etc.). */
  meta?: Record<string, JsonValue>
}

/** Input for the enrichment server function. */
export interface EnrichSpanInput {
  spanId: string
  traceId: string
  /** The session/thread ID (ag_ui.thread_id) — used as Cosmos conversationId. */
  sessionId?: string
  /** Span operation kind ("chat" | "tool" | "mcp" | ...). Source dispatch hint. */
  operation?: string
  /** Tool call id (`gen_ai.tool.call.id`) — required for tool-call enrichment. */
  toolCallId?: string
  /** Hint: the model on this span, so the adapter can choose a source. */
  model?: string
  /** Hint: the agent that owns this span (e.g. "ui_agent"). */
  agentName?: string
}
