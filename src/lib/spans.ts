import type { JsonValue } from './json'

export interface ToolCallResolution {
  subAgent?: Span
  result?: JsonValue
  success: boolean
}

// Index tool-call ids in a trace to their resolution (result + sub-agent
// linkage). Builds the parent→children map once, then resolves each tool
// span in O(1) — avoids the per-call `spans.find` that `findWrappedAgent`
// would do (O(n²) in pathological traces).
export function resolveToolCalls(spans: Span[]): Map<string, ToolCallResolution> {
  const byParent = new Map<string | null, Span[]>()
  for (const s of spans) {
    const arr = byParent.get(s.parentId) ?? []
    arr.push(s)
    byParent.set(s.parentId, arr)
  }
  const map = new Map<string, ToolCallResolution>()
  for (const t of spans) {
    if (t.operation !== 'tool' || !t.toolCallId) continue
    const subAgent = byParent.get(t.id)?.find((c) => c.operation === 'invoke_agent')
    map.set(t.toolCallId, {
      subAgent,
      result: t.toolResult,
      success: !spanHasError(t),
    })
  }
  return map
}

export type SpanKind = 'server' | 'client' | 'internal' | 'producer' | 'consumer'
export type Operation = 'http' | 'chat' | 'tool' | 'invoke_agent'

export interface Span {
  id: string
  traceId: string
  parentId: string | null
  service: string
  kind: SpanKind
  operation: Operation
  name: string
  startMs: number
  endMs: number
  tokens?: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  agentName?: string
  agentDescription?: string
  toolName?: string
  inputParams?: string
  model?: string

  // Present on chat spans — what the LLM was sent and what it replied.
  llmInput?: JsonValue
  llmOutput?: JsonValue
  cachedTokens?: number
  reasoningTokens?: number
  toolDefinitions?: JsonValue
  finishReasons?: string[]
  provider?: string
  ttftMs?: number
  responseId?: string
  systemFingerprint?: string
  // True when OTel span_status was ERROR. Set at the provider boundary;
  // classify-span.ts (attribute-only) does not populate it. spanHasError()
  // ORs this with tool-result error detection.
  hasError?: boolean

  // Present on execute_tool spans — pairing key and the tool's return value.
  toolCallId?: string
  toolResult?: JsonValue

  // Session correlation. `attribute` = lifted from a real semconv key
  // (session.id / gen_ai.conversation.id / langfuse.session.id / ...).
  // `agent-instance` = fallback derived from the agent-instance hex in
  // `invoke_agent <Name>(<hex>)` span names when no attribute is present.
  // UI discloses the source so heuristic-derived sessions don't masquerade
  // as real ones.
  sessionId?: string
  sessionSource?: 'attribute' | 'agent-instance'
}

// Treat a span as root when its declared parent is not present in the trace.
// Some providers (OpenObserve) emit the trace id as the root's parent rather
// than empty — see docs/reference/provider-quirks.md. Applied at the provider
// boundary so consumers can trust `parentId === null` means root.
export function normalizeTraceRoots(spans: Span[]): void {
  const ids = new Set(spans.map((s) => s.id))
  for (const s of spans) {
    if (s.parentId && !ids.has(s.parentId)) s.parentId = null
  }
}

// Stamp every span in a trace with the same sessionId. A real `attribute`
// source wins over the `agent-instance` heuristic when both appear in the
// same trace — so spans that didn't carry the attribute themselves get
// stamped with it rather than with a fallback hex.
export function propagateSessionInTrace(spans: Span[]): void {
  let attrId: string | undefined
  let heuristicId: string | undefined
  for (const s of spans) {
    if (!s.sessionId) continue
    if (s.sessionSource === 'attribute' && !attrId) attrId = s.sessionId
    else if (s.sessionSource === 'agent-instance' && !heuristicId) heuristicId = s.sessionId
  }
  const id = attrId ?? heuristicId
  if (!id) return
  const source: 'attribute' | 'agent-instance' = attrId ? 'attribute' : 'agent-instance'
  for (const s of spans) {
    if (!s.sessionId) {
      s.sessionId = id
      s.sessionSource = source
    }
  }
}

export const KIND_LETTER: Record<SpanKind, string> = {
  server: 's',
  client: 'c',
  internal: 'i',
  producer: 'p',
  consumer: 'u',
}

export function spanHasError(span: Span): boolean {
  if (span.hasError) return true
  const r = span.toolResult
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false
  return r.error === true || r.status === 'error'
}

export function descendantSpans(spans: Span[], rootId: string): Span[] {
  const byParent = new Map<string | null, Span[]>()
  for (const s of spans) {
    const arr = byParent.get(s.parentId) ?? []
    arr.push(s)
    byParent.set(s.parentId, arr)
  }
  const out: Span[] = []
  const walk = (id: string) => {
    for (const c of byParent.get(id) ?? []) {
      out.push(c)
      walk(c.id)
    }
  }
  walk(rootId)
  return out
}

// A session can span multiple traces — each user turn typically lands on its
// own root invoke_agent. Return the shallowest invoke_agent per trace so
// downstream callers can aggregate turns across the whole session.
export function findOrchestratorIds(spans: Span[]): string[] {
  const byId = new Map(spans.map((s) => [s.id, s]))
  const memo = new Map<string, number>()
  const depth = (id: string): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const s = byId.get(id)
    const d = !s || s.parentId === null ? 0 : 1 + depth(s.parentId)
    memo.set(id, d)
    return d
  }
  const perTrace = new Map<string, Span>()
  for (const s of spans) {
    if (s.operation !== 'invoke_agent') continue
    const cur = perTrace.get(s.traceId)
    if (!cur || depth(s.id) < depth(cur.id) || (depth(s.id) === depth(cur.id) && s.startMs < cur.startMs)) {
      perTrace.set(s.traceId, s)
    }
  }
  return [...perTrace.values()].sort((a, b) => a.startMs - b.startMs).map((s) => s.id)
}

export function findOrchestratorId(spans: Span[]): string | null {
  return findOrchestratorIds(spans)[0] ?? null
}

// If a `tool` span wraps a sub-agent invocation (i.e. has an invoke_agent
// child), return that wrapped agent span. This is how OpenAI-style "agent as
// tool" patterns show up in real traces: execute_tool <name> → invoke_agent X.
export function findWrappedAgent(spans: Span[], toolId: string): Span | undefined {
  return spans.find((s) => s.parentId === toolId && s.operation === 'invoke_agent')
}

export function formatCost(usd: number): string | null {
  if (!usd) return null
  if (usd < 0.0001) return '<0.0001'
  return usd.toFixed(4)
}
