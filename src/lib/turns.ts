import type { Span } from './spans'

// One Turn = one top-level invoke_agent run = one user message exchange.
// A run can fire multiple LLM calls internally (tool-call cycles where the
// first chat finishes with `tool_calls` and the next chat carries the tool
// result back to the model), but those are implementation detail — the user
// sees one assistant response per turn.
export interface Turn {
  run: Span
  chats: Span[]
  actions: Span[]
}

export function extractTurns(spans: Span[], orchestratorIds: string | string[]): Turn[] {
  const ids = new Set(Array.isArray(orchestratorIds) ? orchestratorIds : [orchestratorIds])
  if (ids.size === 0) return []
  const byId = new Map(spans.map((s) => [s.id, s]))
  const turns: Turn[] = []
  for (const orchId of ids) {
    const run = byId.get(orchId)
    if (!run) continue
    const chats: Span[] = []
    const actions: Span[] = []
    for (const s of spans) {
      if (s.parentId !== orchId) continue
      if (s.operation === 'chat') chats.push(s)
      else if (s.operation === 'tool' || s.operation === 'invoke_agent') actions.push(s)
    }
    chats.sort((a, b) => a.startMs - b.startMs)
    actions.sort((a, b) => a.startMs - b.startMs)
    turns.push({ run, chats, actions })
  }
  return turns.sort((a, b) => a.run.startMs - b.run.startMs)
}

export interface TurnTotals {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
  durationMs: number
  model: string | undefined
}

export function turnTotals(turn: Turn): TurnTotals {
  let inputTokens = 0
  let outputTokens = 0
  let cachedTokens = 0
  let costUsd = 0
  for (const c of turn.chats) {
    inputTokens += c.inputTokens ?? 0
    outputTokens += c.outputTokens ?? 0
    cachedTokens += c.cachedTokens ?? 0
    costUsd += c.costUsd ?? 0
  }
  const durationMs = Math.max(0, turn.run.endMs - turn.run.startMs)
  // Final assistant message wins on model — if the agent swapped models mid-run
  // (rare), the user cares about which one produced the visible answer.
  const model = turn.chats[turn.chats.length - 1]?.model
  return { inputTokens, outputTokens, cachedTokens, costUsd, durationMs, model }
}
