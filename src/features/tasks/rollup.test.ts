import { describe, expect, it } from 'vitest'
import { mergeTaskRegistry } from '#/extensions/tasks/merge'
import type { AgentTaskRegistryEntry } from '#/extensions/tasks/types'
import type { TraceSummary } from '#/lib/telemetry'
import { rollupTasks, summarizeRollup } from './rollup'

function entry(over: Partial<AgentTaskRegistryEntry> & { id: string }): AgentTaskRegistryEntry {
  return { name: 'Task', status: 'active', ownerUserId: 'u', companyId: 1, createdAtMs: 0, updatedAtMs: 0, ...over }
}

function trace(over: Partial<TraceSummary> & { id: string; startedAtMs: number }): TraceSummary {
  return {
    spanCount: 1,
    durationMs: 100,
    category: 'scheduled',
    ...over,
  }
}

describe('rollupTasks', () => {
  it('groups fires by task.id', () => {
    const traces = [
      trace({ id: 'a', startedAtMs: 1000, taskId: 'job-x', category: 'scheduled' }),
      trace({ id: 'b', startedAtMs: 2000, taskId: 'job-x', category: 'scheduled', hasError: true }),
      trace({ id: 'c', startedAtMs: 3000, taskId: 'job-y', category: 'scheduled' }),
    ]
    const rows = rollupTasks(traces, { fromMs: 0, toMs: 4000 })
    expect(rows).toHaveLength(2)
    const x = rows.find((r) => r.taskId === 'job-x')
    expect(x?.fires).toBe(2)
    expect(x?.errored).toBe(1)
    expect(x?.successRate).toBe(0.5)
    expect(x?.identitySource).toBe('task.id')
  })

  it('filters non-fire categories out', () => {
    const traces = [
      trace({ id: 'a', startedAtMs: 1, taskId: 'job', category: 'scheduled' }),
      trace({ id: 'b', startedAtMs: 2, category: 'chat' }),
    ]
    const rows = rollupTasks(traces, { fromMs: 0, toMs: 100 })
    expect(rows).toHaveLength(1)
  })

  it('drops the event_trigger.execute scheduling shell', () => {
    const traces = [
      trace({ id: 'a', startedAtMs: 1, taskId: 'job-x', category: 'event' }),
      trace({ id: 'b', startedAtMs: 2, category: 'event', rootOperation: 'event_trigger.execute' }),
    ]
    const rows = rollupTasks(traces, { fromMs: 0, toMs: 100 })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.taskId).toBe('job-x')
  })

  it('falls back to derived identity when no task.id', () => {
    const traces = [
      trace({ id: 'a', startedAtMs: 1, serviceName: 'agent-run-test', agent: 'Proverbs', category: 'event' }),
      trace({ id: 'b', startedAtMs: 2, serviceName: 'agent-run-test', agent: 'Proverbs', category: 'event' }),
    ]
    const rows = rollupTasks(traces, { fromMs: 0, toMs: 100 })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.identitySource).toBe('derived')
    expect(rows[0]?.fires).toBe(2)
  })

  it('sorts by fires desc', () => {
    const traces = [
      trace({ id: '1', startedAtMs: 1, taskId: 'a', category: 'scheduled' }),
      trace({ id: '2', startedAtMs: 2, taskId: 'b', category: 'scheduled' }),
      trace({ id: '3', startedAtMs: 3, taskId: 'b', category: 'scheduled' }),
      trace({ id: '4', startedAtMs: 4, taskId: 'b', category: 'scheduled' }),
    ]
    const rows = rollupTasks(traces, { fromMs: 0, toMs: 100 })
    expect(rows[0]?.taskId).toBe('b')
    expect(rows[0]?.fires).toBe(3)
  })

  it('builds sparkline buckets', () => {
    const traces = [
      trace({ id: '1', startedAtMs: 100, taskId: 'a' }),
      trace({ id: '2', startedAtMs: 200, taskId: 'a' }),
      trace({ id: '3', startedAtMs: 800, taskId: 'a' }),
    ]
    const rows = rollupTasks(traces, { fromMs: 0, toMs: 1000, buckets: 10 })
    const spark = rows[0]?.spark ?? []
    expect(spark).toHaveLength(10)
    expect(spark.reduce((n, p) => n + p.fires, 0)).toBe(3)
  })
})

describe('summarizeRollup', () => {
  it('aggregates rows into totals', () => {
    const traces = [
      trace({ id: '1', startedAtMs: 1, taskId: 'a', durationMs: 100 }),
      trace({ id: '2', startedAtMs: 2, taskId: 'a', durationMs: 200, hasError: true }),
      trace({ id: '3', startedAtMs: 3, taskId: 'b', durationMs: 50 }),
    ]
    const rows = rollupTasks(traces, { fromMs: 0, toMs: 100 })
    const s = summarizeRollup(rows)
    expect(s.fires).toBe(3)
    expect(s.errored).toBe(1)
    expect(s.success).toBe(2)
    expect(s.taskCount).toBe(2)
    expect(s.errorRate).toBeCloseTo(1 / 3)
    expect(s.successRate).toBeCloseTo(2 / 3)
    // task 'a' has 1 error → not healthy; task 'b' is clean → healthy
    expect(s.healthyTasks).toBe(1)
  })

  it('does not count never-fired tasks as healthy', () => {
    const rows = mergeTaskRegistry([], [entry({ id: 'job-x' })])
    expect(summarizeRollup(rows).healthyTasks).toBe(0)
  })

  it('returns zeros on empty input', () => {
    const s = summarizeRollup([])
    expect(s).toEqual({
      fires: 0,
      errored: 0,
      success: 0,
      successRate: 0,
      errorRate: 0,
      avgDurationMs: 0,
      taskCount: 0,
      healthyTasks: 0,
    })
  })
})

describe('mergeTaskRegistry', () => {
  it('is a no-op when the registry is empty', () => {
    const rows = rollupTasks([trace({ id: 'a', startedAtMs: 1, taskId: 'job-x' })], { fromMs: 0, toMs: 10 })
    expect(mergeTaskRegistry(rows, [])).toBe(rows)
  })

  it('enriches a fired row with authoritative name + status (case-insensitive id)', () => {
    const rows = rollupTasks([trace({ id: 'a', startedAtMs: 1, taskId: 'JOB-X', taskName: 'old' })], {
      fromMs: 0,
      toMs: 10,
    })
    const merged = mergeTaskRegistry(rows, [
      entry({ id: 'job-x', name: 'Daily report', status: 'paused', totalRuns: 42, succeededRuns: 40 }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      name: 'Daily report',
      taskStatus: 'paused',
      registered: true,
      totalRuns: 42,
      succeededRuns: 40,
    })
  })

  it('appends registry tasks that did not fire as zero-fire rows', () => {
    const rows = rollupTasks([trace({ id: 'a', startedAtMs: 1, taskId: 'job-x' })], { fromMs: 0, toMs: 10 })
    const merged = mergeTaskRegistry(rows, [entry({ id: 'job-x' }), entry({ id: 'job-z', name: 'Never ran' })])
    const z = merged.find((r) => r.taskId === 'job-z')
    expect(z).toMatchObject({ fires: 0, registered: true, name: 'Never ran', identitySource: 'task.id' })
    expect(z?.sampleTraceId).toBe('')
  })
})
