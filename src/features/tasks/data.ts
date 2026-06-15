import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import {
  type AgentTaskRegistryEntry,
  type AgentTaskRun,
  cachedAgentTaskRegistry,
  fetchAgentTaskRuns,
} from '#/extensions'
import { queryKeys, STALE_LIVE_MS } from '#/lib/query-keys'
import { listRecentTraces, type TraceSummary } from '#/lib/telemetry'
import { FIRE_TRIGGER_TYPES } from '#/lib/telemetry/trace-category'
import { parseRangeUserInput, serialize, type TimeRange, windowUs } from '#/lib/time-range'

export interface TasksData {
  traces: TraceSummary[]
  registry: AgentTaskRegistryEntry[]
}

const fetchTasksData = createServerFn({ method: 'GET' })
  .inputValidator(parseRangeUserInput)
  .handler(async ({ data }): Promise<TasksData> => {
    const [traces, registry] = await Promise.all([
      listRecentTraces({
        limit: 500,
        triggerTypes: FIRE_TRIGGER_TYPES,
        ...windowUs(data.range),
        ...(data.userId ? { userId: data.userId } : {}),
      }),
      cachedAgentTaskRegistry(),
    ])
    return { traces: traces?.traces ?? [], registry }
  })

export const tasksQuery = (range: TimeRange, userId = '') =>
  queryOptions({
    queryKey: queryKeys.tasks.window(serialize(range), userId),
    queryFn: () => fetchTasksData({ data: { range, userId } }),
    staleTime: STALE_LIVE_MS,
  })

const validateTaskId = (id: unknown): string => (typeof id === 'string' ? id.trim() : '')

const fetchTaskRuns = createServerFn({ method: 'GET' })
  .inputValidator(validateTaskId)
  .handler(async ({ data: taskId }): Promise<AgentTaskRun[]> => fetchAgentTaskRuns(taskId))

// Authoritative run history for one task (AgentTaskRuns). Backs the fires table
// when telemetry can't match the task's spans. Disabled until a taskId is known.
export const taskRunsQuery = (taskId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.tasks.runs(taskId ?? ''),
    queryFn: () => fetchTaskRuns({ data: taskId ?? '' }),
    enabled: Boolean(taskId),
    staleTime: STALE_LIVE_MS,
  })
