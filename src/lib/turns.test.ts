import { describe, expect, it } from 'vitest'
import { findOrchestratorId, findOrchestratorIds, type Span } from './spans'
import { extractTurns, turnTotals } from './turns'

function span(overrides: Partial<Span> & Pick<Span, 'id' | 'operation'>): Span {
  return {
    traceId: 't1',
    parentId: null,
    service: 'svc',
    kind: 'internal',
    name: overrides.operation,
    startMs: 0,
    endMs: 100,
    ...overrides,
  }
}

describe('findOrchestratorIds', () => {
  it('returns the shallowest invoke_agent per trace', () => {
    const spans: Span[] = [
      span({ id: 'root1', operation: 'http', traceId: 'tr1', endMs: 200 }),
      span({ id: 'orch1', operation: 'invoke_agent', traceId: 'tr1', parentId: 'root1', startMs: 10 }),
      span({ id: 'sub1', operation: 'invoke_agent', traceId: 'tr1', parentId: 'orch1', startMs: 20 }),

      span({ id: 'root2', operation: 'http', traceId: 'tr2', startMs: 500, endMs: 700 }),
      span({ id: 'orch2', operation: 'invoke_agent', traceId: 'tr2', parentId: 'root2', startMs: 510 }),
    ]
    expect(findOrchestratorIds(spans)).toEqual(['orch1', 'orch2'])
    expect(findOrchestratorId(spans)).toBe('orch1')
  })

  it('returns an empty array when no invoke_agent spans exist', () => {
    const spans: Span[] = [span({ id: 'a', operation: 'chat' })]
    expect(findOrchestratorIds(spans)).toEqual([])
    expect(findOrchestratorId(spans)).toBeNull()
  })
})

describe('extractTurns', () => {
  it('rolls multiple chats inside a single agent run into one turn', () => {
    // A tool-call cycle is one turn from the user's perspective: model emits
    // tool_calls in the first chat, the tool runs, the second chat carries the
    // result back. Both chats belong to the same run.
    const spans: Span[] = [
      span({ id: 'orch', operation: 'invoke_agent', startMs: 0, endMs: 100 }),
      span({ id: 'c1', operation: 'chat', parentId: 'orch', startMs: 1 }),
      span({ id: 't1', operation: 'tool', parentId: 'orch', startMs: 2 }),
      span({ id: 'c2', operation: 'chat', parentId: 'orch', startMs: 3 }),
    ]
    const turns = extractTurns(spans, 'orch')
    expect(turns).toHaveLength(1)
    expect(turns[0].chats.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(turns[0].actions.map((a) => a.id)).toEqual(['t1'])
  })

  it('emits a turn even when the agent run had no chat spans', () => {
    const spans: Span[] = [
      span({ id: 'orch', operation: 'invoke_agent' }),
      span({ id: 't1', operation: 'tool', parentId: 'orch', startMs: 1 }),
    ]
    const turns = extractTurns(spans, 'orch')
    expect(turns).toHaveLength(1)
    expect(turns[0].chats).toEqual([])
    expect(turns[0].actions.map((a) => a.id)).toEqual(['t1'])
  })

  it('produces one turn per top-level invoke_agent across a multi-trace session', () => {
    // Mirrors session cff5825a…: 4 ProverbsAgent runs sharing one session id.
    // Some runs have a tool-call cycle (2 chats); each still counts as 1 turn.
    const spans: Span[] = [
      span({ id: 'orchA', operation: 'invoke_agent', traceId: 'A', startMs: 0, endMs: 50 }),
      span({ id: 'a1', operation: 'chat', parentId: 'orchA', traceId: 'A', startMs: 10 }),

      span({ id: 'orchB', operation: 'invoke_agent', traceId: 'B', startMs: 100, endMs: 150 }),
      span({ id: 'b1', operation: 'chat', parentId: 'orchB', traceId: 'B', startMs: 110 }),

      span({ id: 'orchC', operation: 'invoke_agent', traceId: 'C', startMs: 200, endMs: 280 }),
      span({ id: 'c1', operation: 'chat', parentId: 'orchC', traceId: 'C', startMs: 210 }),
      span({ id: 'c-tool', operation: 'tool', parentId: 'orchC', traceId: 'C', startMs: 215 }),
      span({ id: 'c2', operation: 'chat', parentId: 'orchC', traceId: 'C', startMs: 220 }),

      span({ id: 'orchD', operation: 'invoke_agent', traceId: 'D', startMs: 300, endMs: 400 }),
      span({ id: 'd1', operation: 'chat', parentId: 'orchD', traceId: 'D', startMs: 310 }),
      span({ id: 'd-tool', operation: 'tool', parentId: 'orchD', traceId: 'D', startMs: 315 }),
      span({ id: 'd-sub', operation: 'invoke_agent', parentId: 'd-tool', traceId: 'D', startMs: 320 }),
      // Sub-agent's chat is nested under the tool span — it must NOT bubble up
      // into orchD's chats list.
      span({ id: 'd-sub-chat', operation: 'chat', parentId: 'd-sub', traceId: 'D', startMs: 325 }),
      span({ id: 'd2', operation: 'chat', parentId: 'orchD', traceId: 'D', startMs: 360 }),
    ]
    const orchIds = findOrchestratorIds(spans)
    const turns = extractTurns(spans, orchIds)
    expect(turns).toHaveLength(4)
    expect(turns.map((t) => t.run.id)).toEqual(['orchA', 'orchB', 'orchC', 'orchD'])
    expect(turns[2].chats.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(turns[3].chats.map((c) => c.id)).toEqual(['d1', 'd2'])
    // d-sub-chat lives under the sub-agent, not directly under orchD.
    expect(turns[3].chats.map((c) => c.id)).not.toContain('d-sub-chat')
  })

  it('orders turns by the run start time, not by trace insertion order', () => {
    const spans: Span[] = [
      span({ id: 'orchLate', operation: 'invoke_agent', traceId: 'L', startMs: 1000 }),
      span({ id: 'orchEarly', operation: 'invoke_agent', traceId: 'E', startMs: 100 }),
    ]
    const turns = extractTurns(spans, ['orchLate', 'orchEarly'])
    expect(turns.map((t) => t.run.id)).toEqual(['orchEarly', 'orchLate'])
  })

  it('returns an empty list when given no orchestrator ids', () => {
    const spans: Span[] = [span({ id: 'c1', operation: 'chat' })]
    expect(extractTurns(spans, [])).toEqual([])
  })
})

describe('turnTotals', () => {
  it('sums tokens and cost across all chats in the run', () => {
    const spans: Span[] = [
      span({ id: 'orch', operation: 'invoke_agent', startMs: 0, endMs: 1000 }),
      span({
        id: 'c1',
        operation: 'chat',
        parentId: 'orch',
        startMs: 10,
        inputTokens: 100,
        outputTokens: 20,
        cachedTokens: 50,
        costUsd: 0.01,
        model: 'gpt-4o-mini',
      }),
      span({
        id: 'c2',
        operation: 'chat',
        parentId: 'orch',
        startMs: 500,
        inputTokens: 200,
        outputTokens: 30,
        cachedTokens: 150,
        costUsd: 0.02,
        model: 'gpt-4o-mini',
      }),
    ]
    const [turn] = extractTurns(spans, 'orch')
    expect(turnTotals(turn)).toEqual({
      inputTokens: 300,
      outputTokens: 50,
      cachedTokens: 200,
      costUsd: 0.03,
      durationMs: 1000,
      model: 'gpt-4o-mini',
    })
  })

  it('reports the final chat’s model when the run swapped models mid-flight', () => {
    const spans: Span[] = [
      span({ id: 'orch', operation: 'invoke_agent', endMs: 100 }),
      span({ id: 'c1', operation: 'chat', parentId: 'orch', startMs: 1, model: 'gpt-3.5-turbo' }),
      span({ id: 'c2', operation: 'chat', parentId: 'orch', startMs: 2, model: 'gpt-4o-mini' }),
    ]
    const [turn] = extractTurns(spans, 'orch')
    expect(turnTotals(turn).model).toBe('gpt-4o-mini')
  })

  it('returns undefined model and zero tokens for chat-less runs', () => {
    const spans: Span[] = [span({ id: 'orch', operation: 'invoke_agent', endMs: 50 })]
    const [turn] = extractTurns(spans, 'orch')
    expect(turnTotals(turn)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      costUsd: 0,
      durationMs: 50,
      model: undefined,
    })
  })
})
