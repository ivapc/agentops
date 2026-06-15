import { getSqlPool, isSqlConfigured } from '../../server/sql-client'
import type { AgentTaskRegistryEntry } from '../types'

interface AgentTaskDbRow {
  Id: string
  Name: string
  Status: string
  OwnerUserId: string
  CompanyId: number
  ThreadId: string | null
  CreatedAt: Date | string
  UpdatedAt: Date | string
  TotalRuns: number | null
  Succeeded: number | null
  LastStatus: string | null
  LastError: string | null
  LastRunAt: Date | string | null
  SourceKind: string | null
  SourceReference: string | null
  IsRecurring: string | null
  // From EventTriggers — present for event tasks even before they ever fire.
  EvtTriggerType: string | null
  EvtEventType: string | null
  EvtFilters: string | null
  EvtLastTriggeredAt: Date | string | null
  EvtTriggerCount: number | null
}

// Registry + lifetime stats in one round-trip. `agg`/`latest` summarize the run
// history (AgentTaskRuns); `evt` pulls the event-trigger definition (EventTriggers)
// so event tasks are classified — and carry a fire count / last-fired — even before
// their first run, which AgentTaskRuns alone can't tell us. LEFT JOINs so never-run
// and schedule-only tasks still appear.
const QUERY = `
WITH agg AS (
  SELECT AgentTaskId, COUNT(*) AS TotalRuns,
         SUM(CASE WHEN [Status] = 'Succeeded' THEN 1 ELSE 0 END) AS Succeeded
  FROM AgentTaskRuns GROUP BY AgentTaskId
),
latest AS (
  SELECT AgentTaskId, [Status] AS LastStatus,
         JSON_VALUE(Result, '$.ErrorMessage') AS LastError,
         JSON_VALUE(Source, '$.Kind') AS SourceKind,
         JSON_VALUE(Source, '$.Reference') AS SourceReference,
         JSON_VALUE(Source, '$.Context.isRecurring') AS IsRecurring,
         COALESCE(CompletedAt, CreatedAt) AS LastRunAt,
         ROW_NUMBER() OVER (PARTITION BY AgentTaskId ORDER BY COALESCE(CompletedAt, CreatedAt) DESC) AS rn
  FROM AgentTaskRuns
),
evt AS (
  SELECT AgentTaskId, TriggerType, EventType, Filters, LastTriggeredAt, TriggerCount,
         ROW_NUMBER() OVER (PARTITION BY AgentTaskId ORDER BY UpdatedAt DESC) AS rn
  FROM EventTriggers
)
SELECT t.Id, t.Name, t.[Status], t.OwnerUserId, t.CompanyId, t.ThreadId, t.CreatedAt, t.UpdatedAt,
       a.TotalRuns, a.Succeeded, l.LastStatus, l.LastError, l.LastRunAt, l.SourceKind, l.SourceReference, l.IsRecurring,
       e.TriggerType AS EvtTriggerType, e.EventType AS EvtEventType, e.Filters AS EvtFilters,
       e.LastTriggeredAt AS EvtLastTriggeredAt, e.TriggerCount AS EvtTriggerCount
FROM AgentTasks t
LEFT JOIN agg a ON a.AgentTaskId = t.Id
LEFT JOIN latest l ON l.AgentTaskId = t.Id AND l.rn = 1
LEFT JOIN evt e ON e.AgentTaskId = t.Id AND e.rn = 1`

const toMs = (v: Date | string | null): number | undefined =>
  v == null ? undefined : v instanceof Date ? v.getTime() : new Date(v).getTime()

/** Full task registry. Returns [] when SQL isn't configured or the read fails. */
export async function fetchAgentTaskRegistry(): Promise<AgentTaskRegistryEntry[]> {
  if (!isSqlConfigured()) return []
  try {
    const pool = await getSqlPool()
    if (!pool) return []
    const { recordset } = await pool.request().query<AgentTaskDbRow>(QUERY)
    return recordset.map((r) => {
      const isEvent = r.EvtTriggerType != null
      // Prefer run-history-derived trigger info; fall back to the EventTriggers
      // definition so an event task is classified before its first run.
      const triggerSourceKind = r.SourceKind ?? (isEvent ? 'WorkflowEvent' : undefined)
      const triggerRecurring =
        r.IsRecurring != null
          ? r.IsRecurring.toLowerCase() === 'true'
          : isEvent
            ? r.EvtTriggerType?.toLowerCase() === 'standing'
            : undefined
      const totalRuns = r.TotalRuns ?? (r.EvtTriggerCount != null ? Number(r.EvtTriggerCount) : 0)
      return {
        id: String(r.Id).toLowerCase(),
        name: r.Name,
        status: String(r.Status).toLowerCase(),
        ownerUserId: String(r.OwnerUserId),
        companyId: r.CompanyId,
        threadId: r.ThreadId ?? undefined,
        createdAtMs: toMs(r.CreatedAt) ?? 0,
        updatedAtMs: toMs(r.UpdatedAt) ?? 0,
        totalRuns,
        succeededRuns: r.Succeeded ?? 0,
        lastRunStatus: r.LastStatus ?? undefined,
        lastRunError: r.LastError,
        lastRunAtMs: toMs(r.LastRunAt) ?? toMs(r.EvtLastTriggeredAt),
        triggerSourceKind,
        // For event tasks the run's Source.Reference is the (often placeholder)
        // workflow id; the EventType is the meaningful "what fires this".
        triggerSourceRef: isEvent
          ? (r.EvtEventType ?? r.SourceReference ?? undefined)
          : (r.SourceReference ?? undefined),
        triggerRecurring,
        eventType: r.EvtEventType ?? undefined,
        eventTriggerType: r.EvtTriggerType ?? undefined,
        eventFilters: r.EvtFilters ?? undefined,
      }
    })
  } catch (e) {
    console.error('[extensions/tasks/registry]', e)
    return []
  }
}

// Cache the registry server-side so the live-refreshing trace query doesn't
// re-hit SQL on every tick — but keep it short so a freshly-created task shows
// up within ~a minute.
const REGISTRY_TTL_MS = 60_000
let registryCache: { at: number; rows: AgentTaskRegistryEntry[] } | null = null

export async function cachedAgentTaskRegistry(): Promise<AgentTaskRegistryEntry[]> {
  const now = Date.now()
  if (registryCache && now - registryCache.at < REGISTRY_TTL_MS) return registryCache.rows
  const rows = await fetchAgentTaskRegistry()
  registryCache = { at: now, rows }
  return rows
}
