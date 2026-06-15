import sql from 'mssql'
import { getSqlPool, isSqlConfigured } from '../../server/sql-client'
import type { AgentTaskRun } from '../types'

interface AgentTaskRunDbRow {
  Id: string
  Status: string
  CreatedAt: Date | string
  CompletedAt: Date | string | null
  Error: string | null
}

const ms = (v: Date | string): number => (v instanceof Date ? v.getTime() : new Date(v).getTime())

const QUERY = `
SELECT TOP (@limit) Id, [Status], CreatedAt, CompletedAt,
       JSON_VALUE(Result, '$.ErrorMessage') AS Error
FROM AgentTaskRuns
WHERE AgentTaskId = @taskId
ORDER BY COALESCE(CompletedAt, CreatedAt) DESC`

/**
 * Recent runs for one task, newest first. The authoritative fire history —
 * present even when the exported spans carry no `task.id` to link them.
 * Returns [] when SQL isn't configured or the read fails.
 */
export async function fetchAgentTaskRuns(taskId: string, limit = 200): Promise<AgentTaskRun[]> {
  if (!isSqlConfigured() || !taskId) return []
  try {
    const pool = await getSqlPool()
    if (!pool) return []
    const { recordset } = await pool
      .request()
      .input('taskId', sql.UniqueIdentifier, taskId)
      .input('limit', sql.Int, limit)
      .query<AgentTaskRunDbRow>(QUERY)
    return recordset.map((r) => {
      const startedAtMs = ms(r.CreatedAt)
      return {
        id: String(r.Id),
        status: r.Status,
        startedAtMs,
        durationMs: r.CompletedAt ? Math.max(0, ms(r.CompletedAt) - startedAtMs) : 0,
        error: r.Error,
      }
    })
  } catch (e) {
    console.error('[extensions/tasks/runs]', e)
    return []
  }
}
