import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { queryKeys, STALE_TELEMETRY_MS } from '#/lib/query-keys'
import { listLatencyPercentiles } from '#/lib/telemetry'
import { runDetection } from '#/server/detection'
import { listHomeInventory } from '#/server/inbox'

export const HOME_RANGE_DAYS = [1, 7, 14, 30] as const
export type HomeRangeDays = (typeof HOME_RANGE_DAYS)[number]

export function parseHomeRangeDays(value: unknown): HomeRangeDays {
  const days = typeof value === 'string' ? Number(value) : value
  return HOME_RANGE_DAYS.includes(days as HomeRangeDays) ? (days as HomeRangeDays) : 7
}

const fetchHome = createServerFn({ method: 'GET' })
  .inputValidator(parseHomeRangeDays)
  .handler(async ({ data }) => {
    const toUs = Date.now() * 1000
    const fromUs = toUs - data * 24 * 60 * 60 * 1_000_000
    await Promise.allSettled([runDetection('new_tool'), runDetection('new_agent')])
    const [inventory, generationLatency, observationLatency] = await Promise.all([
      listHomeInventory(data),
      listLatencyPercentiles('generation', { fromUs, toUs, limit: 10 }).catch(() => []),
      listLatencyPercentiles('observation', { fromUs, toUs, limit: 10 }).catch(() => []),
    ])
    return { ...inventory, generationLatency, observationLatency }
  })

export const homeQuery = (days: HomeRangeDays = 7) =>
  queryOptions({
    queryKey: queryKeys.home.window(days),
    queryFn: () => fetchHome({ data: days }),
    staleTime: STALE_TELEMETRY_MS,
    refetchInterval: STALE_TELEMETRY_MS,
  })
