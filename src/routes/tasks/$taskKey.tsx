import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { AUTO_REFRESH_MS } from '#/components/auto-refresh-select'
import { Page } from '#/components/page'
import { PageBreadcrumb } from '#/components/page-breadcrumb'
import {
  FiresTable,
  mergeTaskRegistry,
  rollupTasks,
  runsToFires,
  TaskHero,
  taskIdentity,
  taskRunsQuery,
  tasksQuery,
} from '#/features/tasks'
import { useAutoRefresh } from '#/hooks/use-auto-refresh'
import { useTimeRange } from '#/hooks/use-time-range'
import { useScopedUserId } from '#/hooks/use-user'
import type { TraceSummary } from '#/lib/telemetry'
import { windowMs } from '#/lib/time-range'

export const Route = createFileRoute('/tasks/$taskKey')({
  validateSearch: (search: Record<string, unknown>): { trace?: string; session?: string } => {
    const trace = typeof search.trace === 'string' ? search.trace.trim() : ''
    const session = typeof search.session === 'string' ? search.session.trim() : ''
    return {
      ...(trace ? { trace } : {}),
      ...(session ? { session } : {}),
    }
  },
  component: TaskDetail,
})

function TaskDetail() {
  const { taskKey: encoded } = Route.useParams()
  const taskKey = decodeURIComponent(encoded)
  const navigate = useNavigate({ from: Route.fullPath })
  const [range] = useTimeRange()
  const [autoRefresh] = useAutoRefresh()
  const scopedUserId = useScopedUserId()

  const { data, isLoading } = useQuery({
    ...tasksQuery(range, scopedUserId),
    refetchInterval: AUTO_REFRESH_MS[autoRefresh],
  })

  const taskId = taskKey.startsWith('task:') ? taskKey.slice('task:'.length) : undefined
  const { data: runs } = useQuery({
    ...taskRunsQuery(taskId),
    refetchInterval: AUTO_REFRESH_MS[autoRefresh],
  })

  const { row, telemetryFires, fromMs, toMs } = useMemo(() => {
    const { from, to } = windowMs(range)
    if (!data) return { row: undefined, telemetryFires: [] as TraceSummary[], fromMs: from, toMs: to }
    const matchingFires = data.traces.filter((t) => taskIdentity(t).key === taskKey)
    const rows = mergeTaskRegistry(rollupTasks(matchingFires, { fromMs: from, toMs: to }), data.registry)
    return {
      row: rows.find((r) => r.key === taskKey) ?? rows[0],
      telemetryFires: matchingFires.sort((a, b) => b.startedAtMs - a.startedAtMs),
      fromMs: from,
      toMs: to,
    }
  }, [data, taskKey, range])

  // Prefer telemetry fires (they link to a trace); fall back to the authoritative
  // AgentTaskRuns history when the exported spans can't be matched to this task.
  const fires = useMemo(
    () =>
      telemetryFires.length
        ? telemetryFires
        : runsToFires(runs ?? [], { taskId: row?.taskId, taskName: row?.name, agent: row?.agent }),
    [telemetryFires, runs, row?.taskId, row?.name, row?.agent],
  )

  // When the table is backed by DB runs (no telemetry match), the rollup row's
  // window-scoped fire stats are 0 — reflect the DB fires so the hero matches.
  const heroRow = useMemo(() => {
    if (!row || telemetryFires.length || fires.length === 0) return row
    const errored = fires.filter((f) => f.hasError).length
    return {
      ...row,
      fires: fires.length,
      errored,
      successRate: 1 - errored / fires.length,
      avgDurationMs: Math.round(fires.reduce((s, f) => s + f.durationMs, 0) / fires.length),
    }
  }, [row, telemetryFires.length, fires])

  return (
    <div className="flex h-full flex-col">
      <Page
        title={
          <PageBreadcrumb
            crumbs={[
              { label: 'Tasks', to: '/tasks' },
              { label: row?.name ?? row?.taskId ?? humanizeKey(taskKey), className: 'max-w-[420px] truncate' },
            ]}
          />
        }
      >
        {!row ? (
          <div className="px-4 py-12 text-sm text-muted-foreground lg:px-6">
            {isLoading ? 'Loading task…' : 'No fires for this task in the current time window.'}
          </div>
        ) : (
          <>
            <TaskHero
              row={heroRow ?? row}
              fires={fires}
              fromMs={fromMs}
              toMs={toMs}
              onFireClick={(t) => {
                void navigate({ search: (prev) => ({ ...prev, trace: t.id }) })
              }}
            />
            <FiresTable
              data={fires}
              onRowClick={(t) => {
                void navigate({ search: (prev) => ({ ...prev, trace: t.id }) })
              }}
            />
          </>
        )}
      </Page>
    </div>
  )
}

function humanizeKey(key: string): string {
  const [, rest] = key.split(':', 2)
  return rest ?? key
}
