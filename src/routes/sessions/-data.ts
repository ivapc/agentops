import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { queryKeys } from '#/lib/query-keys'
import { getSession, listRecentSessions } from '#/lib/telemetry'
import { parseTimeRangeDays, type TimeRangeDays, timeRangeWindow } from '#/lib/time-range'

const fetchSessions = createServerFn({ method: 'GET' })
  .inputValidator(parseTimeRangeDays)
  .handler(async ({ data }) => {
    return await listRecentSessions({ limit: 50, ...timeRangeWindow(data) })
  })

const fetchCurrentUserSessions = createServerFn({ method: 'GET' })
  .inputValidator((input: { days?: unknown; userId?: unknown }) => ({
    days: parseTimeRangeDays(input.days),
    userId: typeof input.userId === 'string' ? input.userId.trim() : '',
  }))
  .handler(async ({ data }) => {
    if (!data.userId) return { sessions: [] }
    return await listRecentSessions({
      limit: 5,
      ...timeRangeWindow(data.days),
      userId: data.userId,
    })
  })

const fetchSession = createServerFn({ method: 'GET' })
  .inputValidator((input: { sessionId: string; days?: unknown }) => ({
    sessionId: input.sessionId,
    days: parseTimeRangeDays(input.days),
  }))
  .handler(async ({ data }) => {
    return await getSession(data.sessionId, timeRangeWindow(data.days))
  })

export const sessionsQuery = (days: TimeRangeDays = 1) =>
  queryOptions({
    queryKey: queryKeys.sessions.window(days),
    queryFn: () => fetchSessions({ data: days }),
  })

export const currentUserSessionsQuery = (days: TimeRangeDays = 1, userId = '') =>
  queryOptions({
    queryKey: queryKeys.sessions.currentUserWindow(days, userId),
    queryFn: () => fetchCurrentUserSessions({ data: { days, userId } }),
    enabled: userId.length > 0,
  })

export const sessionQuery = (id: string, days: TimeRangeDays = 1) =>
  queryOptions({
    queryKey: queryKeys.sessions.detailWindow(id, days),
    queryFn: () => fetchSession({ data: { sessionId: id, days } }),
  })
