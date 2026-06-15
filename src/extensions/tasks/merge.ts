import type { TaskKind, TaskRow } from '#/features/tasks/rollup'
import type { TraceSummary } from '#/lib/telemetry'
import type { AgentTaskRegistryEntry, AgentTaskRun } from './types'

// Kind for a registry row that hasn't fired in-window (so no telemetry task.kind).
// The last run's trigger source tells us event-vs-scheduled; IsRecurring splits
// cron from one_shot. Truly never-run tasks stay 'unknown' ("Task").
function registryKind(e: AgentTaskRegistryEntry): TaskKind {
  switch (e.triggerSourceKind) {
    case 'WorkflowEvent':
    case 'Channel':
    case 'ChainStep':
      return 'event'
    case 'Schedule':
      return e.triggerRecurring ? 'cron' : 'one_shot'
    default:
      return 'unknown'
  }
}

function withRegistry(row: TaskRow, e: AgentTaskRegistryEntry): TaskRow {
  return {
    ...row,
    name: e.name || row.name,
    registered: true,
    // The registry ThreadId is the origin chat ("Created by") — authoritative
    // over the fire-derived session, and present even before the task fires.
    conversationId: e.threadId ?? row.conversationId,
    taskStatus: e.status,
    totalRuns: e.totalRuns,
    succeededRuns: e.succeededRuns,
    lastRunStatus: e.lastRunStatus,
    lastRunError: e.lastRunError,
    lastRunAtMs: e.lastRunAtMs,
    ownerUserId: e.ownerUserId,
    companyId: e.companyId,
    triggerSourceKind: e.triggerSourceKind,
    triggerSourceRef: e.triggerSourceRef,
    createdAtMs: e.createdAtMs,
    updatedAtMs: e.updatedAtMs,
    eventType: e.eventType,
    eventTriggerType: e.eventTriggerType,
    eventFilters: e.eventFilters,
  }
}

// Left-join the AgentTasks registry onto fire-derived rows. Matched rows get
// authoritative name + status; registry tasks that didn't fire in the window
// are appended as zero-fire rows (the paused / never-fired / missed view that
// telemetry alone can't surface). No-op when the registry is empty.
export function mergeTaskRegistry(rows: TaskRow[], registry: AgentTaskRegistryEntry[]): TaskRow[] {
  if (registry.length === 0) return rows
  const byId = new Map(registry.map((e) => [e.id, e]))
  const matched = new Set<string>()

  const enriched = rows.map((row) => {
    const entry = row.taskId ? byId.get(row.taskId.toLowerCase()) : undefined
    if (!entry) return row
    matched.add(entry.id)
    return withRegistry(row, entry)
  })

  const unfired = registry
    .filter((e) => !matched.has(e.id))
    .map(
      (e): TaskRow =>
        withRegistry(
          {
            key: `task:${e.id}`,
            identitySource: 'task.id',
            kind: registryKind(e),
            taskId: e.id,
            category: 'orphan',
            fires: 0,
            errored: 0,
            successRate: 1,
            avgDurationMs: 0,
            lastFireMs: 0,
            spark: [],
            sampleTraceId: '',
          },
          e,
        ),
    )

  return [...enriched, ...unfired]
}

// Synthesize fire rows from the authoritative AgentTaskRuns history, for tasks
// whose exported spans can't be matched by telemetry (missing `task.id`).
// spanCount 0 is the signal to the fires table that there's no linked trace.
export function runsToFires(
  runs: AgentTaskRun[],
  ctx: { taskId?: string; taskName?: string; agent?: string },
): TraceSummary[] {
  return runs.map((r) => ({
    id: r.id,
    startedAtMs: r.startedAtMs,
    durationMs: r.durationMs,
    spanCount: 0,
    hasError: r.status.toLowerCase() !== 'succeeded',
    category: 'scheduled',
    taskId: ctx.taskId,
    taskName: ctx.taskName,
    agent: ctx.agent,
  }))
}
