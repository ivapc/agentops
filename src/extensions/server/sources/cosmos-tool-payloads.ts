import type { Container } from '@azure/cosmos'
import { sql } from 'drizzle-orm'
import { db } from '#/db'
import { metricRollup } from '#/db/schema'
import type { ToolPayloadRow, TopOpts } from '#/lib/telemetry/types'
import { getContainer, isConfigured } from '../cosmos-client'

const METRIC_KEY = 'tool_payload_size'

const SYNC_INTERVAL_SEC = 12 * 3600 // 12h — don't hit Cosmos more often than this

/**
 * Cosmos DB → SQLite cached source for real (untruncated) tool result sizes.
 * First call seeds from last 24h, subsequent calls serve from SQLite.
 * Syncs delta from Cosmos at most once per 12h.
 */
export async function cosmosToolPayloads(opts?: TopOpts): Promise<ToolPayloadRow[] | null> {
  if (!isConfigured()) return null
  const limit = opts?.limit ?? 5

  try {
    const watermark = getWatermark()
    const now = Math.floor(Date.now() / 1000)

    if (watermark === 0) {
      // First ever: seed from last 24h
      const container = getContainer('messages')
      if (!container) return null
      await syncFromCosmos(container, now - 86400, now)
    } else if (now - watermark > SYNC_INTERVAL_SEC) {
      // Stale: fetch delta
      const container = getContainer('messages')
      if (!container) return buildRowsFromDb(limit)
      await syncFromCosmos(container, watermark, now)
    }

    return buildRowsFromDb(limit)
  } catch (e) {
    console.error('[extensions/cosmos-tool-payloads]', e)
    // Graceful: return whatever is in SQLite
    return buildRowsFromDb(limit)
  }
}

function getWatermark(): number {
  const row = db.get<{ max: number | null }>(
    sql`SELECT MAX(period_end) as max FROM metric_rollup WHERE metric = ${METRIC_KEY}`,
  )
  return row?.max ?? 0
}

function buildRowsFromDb(limit: number): ToolPayloadRow[] | null {
  const stats = db.all<{ bucket_key: string; cnt: number; avg_size: number; max_size: number; sample_ref: string }>(
    sql`SELECT bucket_key, COUNT(*) as cnt, AVG(value) as avg_size, MAX(value) as max_size,
        (SELECT t2.sample_ref FROM metric_rollup t2 WHERE t2.metric = ${METRIC_KEY} AND t2.bucket_key = t.bucket_key ORDER BY t2.value DESC LIMIT 1) as sample_ref
        FROM metric_rollup t WHERE t.metric = ${METRIC_KEY} GROUP BY bucket_key ORDER BY max_size DESC LIMIT ${limit}`,
  )
  if (!stats || stats.length === 0) return null

  const rows: ToolPayloadRow[] = []
  for (const s of stats) {
    const sizes = db.all<{ value: number }>(
      sql`SELECT value FROM metric_rollup WHERE metric = ${METRIC_KEY} AND bucket_key = ${s.bucket_key} ORDER BY value`,
    )
    const sizeArr = sizes.map((r) => r.value)
    const p95Idx = Math.min(Math.floor(sizeArr.length * 0.95), sizeArr.length - 1)
    rows.push({
      name: s.bucket_key,
      avgChars: Math.round(s.avg_size),
      p95Chars: sizeArr[p95Idx],
      maxChars: s.max_size,
      count: s.cnt,
      sampleSessionId: s.sample_ref,
    })
  }
  rows.sort((a, b) => b.p95Chars - a.p95Chars)
  return rows.slice(0, limit)
}

async function syncFromCosmos(container: Container, fromSec: number, toSec: number) {
  const params = [
    { name: '@fromSec', value: fromSec },
    { name: '@toSec', value: toSec },
  ]

  // Step 1: Build callId → toolName map from assistant messages
  const callIdToName = new Map<string, string>()
  const callDocs = await fetchPaged<{ message: string }>(
    container,
    `SELECT c.message FROM c
     WHERE c.type = "ChatMessage" AND c.role = "assistant"
       AND c.timestamp > @fromSec AND c.timestamp <= @toSec
       AND CONTAINS(c.message, "functionCall")`,
    params,
  )

  for (const doc of callDocs) {
    try {
      const msg = JSON.parse(doc.message)
      for (const c of (msg.Contents ?? msg.contents ?? []) as Record<string, unknown>[]) {
        if (c.$type === 'functionCall') {
          const id = (c.CallId ?? c.callId) as string | undefined
          const name = (c.Name ?? c.name) as string | undefined
          if (id && name) callIdToName.set(id, name)
        }
      }
    } catch {
      /* skip */
    }
  }

  // Step 2: Process tool results and insert into SQLite
  const resultDocs = await fetchPaged<{ conversationId: string; message: string; timestamp: number }>(
    container,
    `SELECT c.conversationId, c.message, c.timestamp FROM c
     WHERE c.type = "ChatMessage" AND c.role = "tool"
       AND c.timestamp > @fromSec AND c.timestamp <= @toSec
       AND CONTAINS(c.message, "functionResult")`,
    params,
  )

  const inserts: { toolName: string; size: number; threadId: string; timestamp: number }[] = []
  for (const doc of resultDocs) {
    try {
      const msg = JSON.parse(doc.message)
      for (const r of (msg.Contents ?? msg.contents ?? []) as Record<string, unknown>[]) {
        if (r.$type !== 'functionResult') continue
        const callId = (r.CallId ?? r.callId) as string | undefined
        const toolName = callId ? callIdToName.get(callId) : undefined
        if (!toolName) continue
        const result = r.Result ?? r.result
        const len = (typeof result === 'string' ? result : JSON.stringify(result ?? '')).length
        inserts.push({ toolName, size: len, threadId: doc.conversationId, timestamp: doc.timestamp })
      }
    } catch {
      /* skip */
    }
  }

  // Batch insert into metric_rollup
  if (inserts.length > 0) {
    const now = new Date()
    db.insert(metricRollup)
      .values(
        inserts.map((i) => ({
          metric: METRIC_KEY,
          bucketKey: i.toolName,
          value: i.size,
          periodStart: new Date(i.timestamp * 1000),
          periodEnd: new Date(i.timestamp * 1000),
          computedAt: now,
          sampleRef: i.threadId,
        })),
      )
      .run()
  }
}

/** Small-page iterator to stay under RU budget. */
async function fetchPaged<T>(
  container: Container,
  query: string,
  parameters: { name: string; value: string | number | boolean | null }[],
): Promise<T[]> {
  const iter = container.items.query<T>({ query, parameters }, { maxItemCount: 50 })
  const results: T[] = []
  while (iter.hasMoreResults()) {
    const { resources } = await iter.fetchNext()
    if (resources) results.push(...resources)
  }
  return results
}

/**
 * Fetch the largest tool result for a given tool name in a given thread.
 * Single-partition query (~2-3 RU). Returns the raw result text or null.
 */
export async function fetchToolPayloadSample(toolName: string, threadId: string): Promise<string | null> {
  if (!isConfigured()) return null
  const container = getContainer('messages')
  if (!container) return null

  try {
    // Get functionCall messages to find callIds for this tool
    const { resources: callDocs } = await container.items
      .query<{ message: string }>({
        query: `SELECT c.message FROM c
        WHERE c.conversationId = @threadId
          AND c.type = "ChatMessage" AND c.role = "assistant"
          AND CONTAINS(c.message, "functionCall")`,
        parameters: [{ name: '@threadId', value: threadId }],
      })
      .fetchAll()

    const callIds = new Set<string>()
    for (const doc of callDocs) {
      try {
        const msg = JSON.parse(doc.message)
        for (const c of (msg.Contents ?? msg.contents ?? []) as Record<string, unknown>[]) {
          if (c.$type === 'functionCall') {
            const name = (c.Name ?? c.name) as string | undefined
            const id = (c.CallId ?? c.callId) as string | undefined
            if (name === toolName && id) callIds.add(id)
          }
        }
      } catch {
        /* skip */
      }
    }

    if (callIds.size === 0) return null

    // Get functionResult messages for those callIds
    const { resources: resultDocs } = await container.items
      .query<{ message: string }>({
        query: `SELECT c.message FROM c
        WHERE c.conversationId = @threadId
          AND c.type = "ChatMessage" AND c.role = "tool"
          AND CONTAINS(c.message, "functionResult")`,
        parameters: [{ name: '@threadId', value: threadId }],
      })
      .fetchAll()

    let largest = ''
    for (const doc of resultDocs) {
      try {
        const msg = JSON.parse(doc.message)
        for (const r of (msg.Contents ?? msg.contents ?? []) as Record<string, unknown>[]) {
          if (r.$type !== 'functionResult') continue
          const callId = (r.CallId ?? r.callId) as string | undefined
          if (!callId || !callIds.has(callId)) continue
          const result = r.Result ?? r.result
          const text = typeof result === 'string' ? result : JSON.stringify(result ?? '', null, 2)
          if (text.length > largest.length) largest = text
        }
      } catch {
        /* skip */
      }
    }

    return largest || null
  } catch (e) {
    console.error('[extensions/cosmos-tool-payloads] fetchToolPayloadSample:', e)
    return null
  }
}
