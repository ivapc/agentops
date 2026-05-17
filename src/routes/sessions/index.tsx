import { ChatBubbleLeftRightIcon } from '@heroicons/react/20/solid'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { AUTO_REFRESH_MS, AutoRefreshSelect, DEFAULT_AUTO_REFRESH_INTERVAL } from '#/components/auto-refresh-select'
import { EmptyState } from '#/components/empty-state'
import { EnvSelect } from '#/components/env-select'
import { SearchInput } from '#/components/search-input'
import { TimeRangeSelect } from '#/components/time-range-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { useEnv } from '#/hooks/use-env'
import type { SessionSummary } from '#/lib/telemetry'
import { parseTimeRangeDays, type TimeRangeDays } from '#/lib/time-range'
import { SessionRow } from './-components/session-row'
import { SessionsDrawerHost } from './-components/sessions-drawer-host'
import { parseStatusFilter, type StatusFilter, StatusSelect } from './-components/status-select'
import { sessionsQuery } from './-data'

export const Route = createFileRoute('/sessions/')({
  validateSearch: (search: Record<string, unknown>): SessionsSearch => ({
    days: parseTimeRangeDays(search.days),
    q: typeof search.q === 'string' && search.q.length > 0 ? search.q : undefined,
    status: parseStatusFilter(search.status),
  }),
  loaderDeps: ({ search }) => ({ days: search.days }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(sessionsQuery(deps.days)),
  component: SessionsList,
})

interface SessionsSearch {
  days: TimeRangeDays
  q?: string
  status?: Exclude<StatusFilter, 'all'>
}

function SessionsList() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [autoRefresh, setAutoRefresh] = useState(DEFAULT_AUTO_REFRESH_INTERVAL)
  const {
    data: loaderData,
    refetch,
    isFetching,
  } = useQuery({
    ...sessionsQuery(search.days),
    refetchInterval: AUTO_REFRESH_MS[autoRefresh],
  })
  const sessions: SessionSummary[] = loaderData?.sessions ?? []

  const query = search.q ?? ''
  const status = search.status ?? 'all'
  const [env, setEnv] = useEnv()
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(null)

  const setQuery = (nextQuery: string) => {
    navigate({
      replace: true,
      search: (prev) => ({ ...prev, q: nextQuery || undefined }),
    })
  }

  const setStatus = (nextStatus: StatusFilter) => {
    navigate({
      replace: true,
      search: (prev) => ({ ...prev, status: nextStatus === 'all' ? undefined : nextStatus }),
    })
  }

  const setDays = (days: TimeRangeDays) => {
    navigate({
      search: (prev) => ({ ...prev, days }),
    })
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions.filter((s) => {
      const hasError = !!s.hasError
      if (status === 'ok' && hasError) return false
      if (status === 'error' && !hasError) return false
      if (q) {
        const agents = s.agents.join(' ').toLowerCase()
        const title = s.title?.toLowerCase() ?? ''
        const user = [s.userName, s.userId, s.host].filter(Boolean).join(' ').toLowerCase()
        if (!agents.includes(q) && !s.sessionId.toLowerCase().includes(q) && !title.includes(q) && !user.includes(q)) {
          return false
        }
      }
      return true
    })
  }, [sessions, query, status])

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-4">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-white">Sessions</h1>
        {loaderData?.provider === 'openobserve' && (
          <span title={loaderData.fingerprint} className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
            via {loaderData.provider}
          </span>
        )}
        {loaderData?.truncated && (
          <span
            title="Scan hit its row cap; older sessions may be missing. Narrow the time range to see them."
            className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-300"
          >
            truncated
          </span>
        )}
        <div className="flex w-full min-w-0 flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-center">
          <SearchInput value={query} onChange={setQuery} placeholder="Search agents, users, ids…" />
          <div className="flex flex-wrap items-center gap-2">
            <EnvSelect value={env} onChange={setEnv} />
            <TimeRangeSelect value={search.days} onChange={setDays} />
            <StatusSelect value={status} onChange={setStatus} />
            <AutoRefreshSelect
              value={autoRefresh}
              onChange={setAutoRefresh}
              onRefresh={() => {
                void refetch()
              }}
              loading={isFetching}
            />
          </div>
        </div>
      </header>

      {sessions.length === 0 ? (
        <EmptyState
          icon={ChatBubbleLeftRightIcon}
          title="No sessions yet"
          description={
            <>
              Emit{' '}
              <code className="rounded bg-zinc-950/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-zinc-800 dark:bg-white/[0.08] dark:text-zinc-200">
                session.id
              </code>{' '}
              on spans, or use{' '}
              <code className="rounded bg-zinc-950/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-zinc-800 dark:bg-white/[0.08] dark:text-zinc-200">
                invoke_agent Name(hex)
              </code>{' '}
              naming so rows can be derived.
            </>
          }
        />
      ) : (
        <Table
          dense
          className="-mx-3 lg:-mx-4 [&_table]:table-fixed [&_tbody_td:first-child]:pl-3 [&_tbody_td:last-child]:pr-3 [&_tbody_td]:border-b-zinc-950/10 [&_thead_th:first-child]:pl-3 [&_thead_th:last-child]:pr-3 dark:[&_tbody_td]:border-b-white/10 lg:[&_tbody_td:first-child]:pl-4 lg:[&_tbody_td:last-child]:pr-4 lg:[&_thead_th:first-child]:pl-4 lg:[&_thead_th:last-child]:pr-4"
        >
          <TableHead>
            <TableRow>
              <TableHeader className="w-28">Last seen</TableHeader>
              <TableHeader className="w-[14%]">Session</TableHeader>
              <TableHeader>Input</TableHeader>
              <TableHeader className="w-[14%]">User</TableHeader>
              <TableHeader className="w-20 text-right">Tokens</TableHeader>
              <TableHeader className="w-20 text-right">Cost</TableHeader>
              <TableHeader className="w-14 text-right">Turns</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-zinc-500 dark:text-zinc-400">
                  No sessions match your filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((s) => (
                <SessionRow key={s.sessionId} session={s} onOpenSession={() => setPreviewSessionId(s.sessionId)} />
              ))
            )}
          </TableBody>
        </Table>
      )}

      <SessionsDrawerHost
        previewSessionId={previewSessionId}
        days={search.days}
        onClose={() => setPreviewSessionId(null)}
      />
    </div>
  )
}
