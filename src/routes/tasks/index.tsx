import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { AUTO_REFRESH_MS } from '#/components/auto-refresh-select'
import { Page } from '#/components/page'
import {
  MetricTiles,
  mergeTaskRegistry,
  rollupTasks,
  summarizeRollup,
  TasksDataTable,
  tasksQuery,
} from '#/features/tasks'
import { useAutoRefresh } from '#/hooks/use-auto-refresh'
import { useTimeRange } from '#/hooks/use-time-range'
import { useScopedUserId } from '#/hooks/use-user'
import { windowMs } from '#/lib/time-range'

export const Route = createFileRoute('/tasks/')({
  validateSearch: (search: Record<string, unknown>): { userId?: string; trace?: string; session?: string } => {
    const userId = typeof search.userId === 'string' ? search.userId.trim() : ''
    const trace = typeof search.trace === 'string' ? search.trace.trim() : ''
    const session = typeof search.session === 'string' ? search.session.trim() : ''
    return {
      ...(userId ? { userId } : {}),
      ...(trace ? { trace } : {}),
      ...(session ? { session } : {}),
    }
  },
  component: TasksPage,
})

function TasksPage() {
  const { userId: overrideUserId } = Route.useSearch()
  const navigate = useNavigate()
  const [range, setRange] = useTimeRange()
  const [autoRefresh, setAutoRefresh] = useAutoRefresh()
  const globalScopedUserId = useScopedUserId()
  const scopedUserId = overrideUserId ?? globalScopedUserId

  const { data, isLoading, isFetching, refetch } = useQuery({
    ...tasksQuery(range, scopedUserId),
    refetchInterval: AUTO_REFRESH_MS[autoRefresh],
  })

  const rows = useMemo(() => {
    if (!data) return []
    const { from, to } = windowMs(range)
    return mergeTaskRegistry(rollupTasks(data.traces, { fromMs: from, toMs: to }), data.registry)
  }, [data, range])

  const summary = useMemo(() => summarizeRollup(rows), [rows])

  return (
    <Page title="Tasks">
      <MetricTiles summary={summary} />
      <TasksDataTable
        data={rows}
        isLoading={isLoading}
        onRowClick={(row) => {
          void navigate({ to: '/tasks/$taskKey', params: { taskKey: encodeURIComponent(row.key) } })
        }}
        range={range}
        onRangeChange={setRange}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        onRefresh={() => {
          void refetch()
        }}
        refreshing={isFetching}
      />
    </Page>
  )
}
