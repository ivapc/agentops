import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Area, AreaChart } from 'recharts'
import { DataTableColumnHeader } from '#/components/data-table-column-header'
import { KindBadge } from '#/components/kind-badge'
import { RelativeTime } from '#/components/relative-time'
import { Badge } from '#/components/ui/badge'
import { eventTriggerView } from '#/extensions/tasks/event'
import { type TaskRow, taskRecencyMs } from '#/features/tasks/rollup'
import { formatDuration, formatPercent, metricTone } from '#/lib/format'
import { ACCENT } from '#/lib/tone'
import { cn } from '#/lib/utils'

export const taskColumns: ColumnDef<TaskRow>[] = [
  {
    accessorKey: 'status',
    accessorFn: (r) => (r.errored > 0 ? 'error' : 'ok'),
    header: () => null,
    cell: () => null,
    filterFn: (row, _id, value: string[]) =>
      Array.isArray(value) && value.includes(row.original.errored > 0 ? 'error' : 'ok'),
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: 'registryStatus',
    accessorFn: (r) => registryState(r),
    header: () => null,
    cell: () => null,
    filterFn: (row, _id, value: string[]) =>
      !Array.isArray(value) || value.length === 0 || value.includes(registryState(row.original)),
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: 'triggerSource',
    accessorFn: (r) => r.triggerSourceKind ?? '',
    header: () => null,
    cell: () => null,
    filterFn: (row, _id, value: string[]) =>
      !Array.isArray(value) || value.length === 0 || value.includes(row.original.triggerSourceKind ?? ''),
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: 'kind',
    accessorFn: (r) => r.kind,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Kind" />,
    cell: ({ row }) => <KindBadge kind={row.original.kind} />,
    filterFn: (row, _id, value: string[]) => {
      if (!Array.isArray(value) || value.length === 0) return true
      return value.includes(row.original.kind)
    },
    enableSorting: false,
  },
  {
    id: 'name',
    accessorFn: (r) => r.name ?? r.taskId ?? r.key,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
    cell: ({ row }) => {
      const r = row.original
      const isId = !r.name && (r.taskId || r.identitySource !== 'task.id')
      const label = r.name ?? r.taskId ?? deriveLabel(r.key)
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn('block max-w-[260px] truncate', isId && 'font-mono text-[12px]')} title={label}>
            {label}
          </span>
          {r.identitySource === 'derived' && (
            <Badge
              variant="outline"
              className="shrink-0 px-1.5 text-[10px] text-muted-foreground"
              title="No task.id on the root span — grouped by service+agent+trigger"
            >
              derived
            </Badge>
          )}
          {r.taskStatus === 'paused' && (
            <Badge
              variant="outline"
              className={cn('shrink-0 px-1.5 text-[10px]', ACCENT.amber.status)}
              title="Paused in the task registry"
            >
              paused
            </Badge>
          )}
          {r.registered && r.fires === 0 && (r.totalRuns ?? 0) === 0 && r.taskStatus !== 'paused' && (
            <Badge
              variant="outline"
              className="shrink-0 px-1.5 text-[10px] text-muted-foreground"
              title="Registered task that has never run"
            >
              never run
            </Badge>
          )}
          {r.kind === 'one_shot' && r.fires > 1 && r.identitySource === 'task.id' && (
            <Badge
              variant="outline"
              className={cn('shrink-0 px-1.5 text-[10px]', ACCENT.amber.status)}
              title={`One-shot task fired ${r.fires}× — extra fires are retries of the same run`}
            >
              retried
            </Badge>
          )}
        </div>
      )
    },
    filterFn: (row, _id, value) => {
      const q = String(value ?? '')
        .trim()
        .toLowerCase()
      if (!q) return true
      const r = row.original
      const haystack = [
        r.name ?? '',
        r.taskId ?? '',
        r.schedule ?? '',
        r.source ?? '',
        r.agent ?? '',
        r.serviceName ?? '',
        r.triggerSourceKind ?? '',
        r.triggerSourceRef ?? '',
        r.ownerUserId ?? '',
        r.conversationId ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    },
  },
  {
    id: 'trigger',
    accessorFn: (r) => r.schedule ?? r.source ?? r.triggerSourceKind ?? '',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Trigger" />,
    cell: ({ row }) => {
      const r = row.original
      // Event tasks: show the event type + filter summary, full details on hover.
      const ev = eventTriggerView(r)
      if (ev) {
        return (
          <div className="flex max-w-[200px] min-w-0 flex-col leading-tight" title={ev.tooltip}>
            <span className="truncate font-mono text-[11px]">{ev.eventType}</span>
            {ev.filterSummary && <span className="truncate text-[10px] text-muted-foreground">{ev.filterSummary}</span>}
          </div>
        )
      }
      const primary =
        r.schedule ??
        r.source ??
        (r.triggerSourceKind ? (TRIGGER_KIND_LABEL[r.triggerSourceKind] ?? r.triggerSourceKind) : undefined)
      const ref = r.triggerSourceRef
      if (!primary && !ref) return <span className="text-muted-foreground/60">—</span>
      return (
        <div className="flex max-w-[180px] min-w-0 flex-col leading-tight">
          {primary && (
            <span className="truncate font-mono text-[11px]" title={primary}>
              {primary}
            </span>
          )}
          {ref && (
            <span className="truncate font-mono text-[10px] text-muted-foreground" title={ref}>
              {ref}
            </span>
          )}
        </div>
      )
    },
    enableSorting: false,
  },
  {
    accessorKey: 'agent',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Agent" />,
    cell: ({ row }) => {
      const agent = row.original.agent ?? row.original.serviceName
      return agent ? (
        <span className="block max-w-[200px] truncate" title={agent}>
          {agent}
        </span>
      ) : (
        <span className="text-muted-foreground/60">—</span>
      )
    },
    enableSorting: false,
  },
  {
    accessorKey: 'fires',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Fires" className="justify-end" />,
    cell: ({ row }) => {
      const r = row.original
      return (
        <div className="flex items-center justify-end gap-2">
          <AreaChart width={56} height={24} data={r.spark} className="shrink-0">
            <defs>
              <linearGradient id={`spark-${r.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.35} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="fires"
              stroke="currentColor"
              strokeWidth={1.2}
              fill={`url(#spark-${r.key})`}
              isAnimationActive={false}
            />
          </AreaChart>
          <span className="tabular-nums">{r.fires.toLocaleString()}</span>
        </div>
      )
    },
  },
  {
    id: 'success',
    accessorFn: (r) => r.successRate,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Success" className="justify-end" />,
    cell: ({ row }) => {
      const r = row.original
      if (r.fires === 0) return <div className="text-right text-muted-foreground/60">—</div>
      const errRate = 1 - r.successRate
      const tone = errRate >= 0.1 ? ACCENT.rose.status : errRate >= 0.02 ? ACCENT.amber.status : ''
      return <div className={cn('text-right tabular-nums', tone)}>{formatPercent(r.fires - r.errored, r.fires)}</div>
    },
  },
  {
    id: 'avgDuration',
    accessorFn: (r) => r.avgDurationMs,
    header: ({ column }) => <DataTableColumnHeader column={column} title="Avg dur" className="justify-end" />,
    cell: ({ row }) => {
      const r = row.original
      if (r.fires === 0) return <div className="text-right text-muted-foreground/60">—</div>
      const ms = r.avgDurationMs
      return <div className={cn('text-right tabular-nums', metricTone('duration', ms))}>{formatDuration(ms)}</div>
    },
  },
  {
    id: 'allTime',
    accessorFn: (r) => r.totalRuns ?? -1,
    header: ({ column }) => <DataTableColumnHeader column={column} title="All-time" className="justify-end" />,
    cell: ({ row }) => {
      const r = row.original
      if (r.totalRuns == null) return <div className="text-right text-muted-foreground/60">—</div>
      const lastFailed = !!r.lastRunStatus && r.lastRunStatus.toLowerCase() !== 'succeeded'
      const title = r.lastRunStatus
        ? `Last run: ${r.lastRunStatus}${r.lastRunError ? ` — ${r.lastRunError}` : ''}`
        : undefined
      return (
        <div className="text-right tabular-nums" title={title}>
          <span>{r.totalRuns.toLocaleString()}</span>
          {r.totalRuns > 0 && (
            <>
              <span className="mx-1 text-muted-foreground/40">·</span>
              <span className={cn('text-[11px]', lastFailed ? ACCENT.rose.status : 'text-muted-foreground')}>
                {formatPercent(Math.min(r.succeededRuns ?? 0, r.totalRuns), r.totalRuns)}
              </span>
            </>
          )}
        </div>
      )
    },
  },
  {
    id: 'lastFireMs',
    accessorFn: (r) => taskRecencyMs(r),
    header: ({ column }) => <DataTableColumnHeader column={column} title="Last fire" />,
    cell: ({ row }) => {
      const r = row.original
      if (r.lastFireMs > 0)
        return <RelativeTime ts={r.lastFireMs} className="whitespace-nowrap tabular-nums text-muted-foreground" />
      if (r.createdAtMs)
        return (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground/60">
            created <RelativeTime ts={r.createdAtMs} />
          </span>
        )
      return <span className="text-muted-foreground/60">never</span>
    },
  },
  {
    id: 'createdBy',
    accessorFn: (r) => r.conversationId ?? '',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Created by" />,
    cell: ({ row }) => {
      const sessionId = row.original.conversationId
      if (!sessionId) return <span className="text-muted-foreground/60">—</span>
      return (
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId }}
          search={{ range: 7, view: 'conversation' }}
          className="font-mono text-[11px] text-muted-foreground hover:underline"
          onClick={(e) => e.stopPropagation()}
          title={sessionId}
        >
          →chat
        </Link>
      )
    },
    enableSorting: false,
  },
]

export const TRIGGER_KIND_LABEL: Record<string, string> = {
  Schedule: 'schedule',
  WorkflowEvent: 'event',
  Channel: 'channel',
  ChainStep: 'chain step',
}

function registryState(r: TaskRow): 'active' | 'paused' | 'never_run' | '' {
  if (r.taskStatus === 'paused') return 'paused'
  if (r.registered && (r.totalRuns ?? 0) === 0) return 'never_run'
  if (r.registered) return 'active'
  return ''
}

function deriveLabel(key: string): string {
  const [, rest] = key.split(':', 2)
  if (!rest) return key
  const parts = rest.split('|').filter(Boolean)
  return parts.slice(-2).join(' · ') || rest
}
