/**
 * One-shot seed script: populates metric_rollup (tool_payload_size) in SQLite from Cosmos.
 * Throttles between pages to avoid 429s on low-RU instances.
 *
 * Usage: npx tsx scripts/seed-tool-payloads.ts [--days 7]
 */
import { CosmosClient } from '@azure/cosmos'
import Database from 'better-sqlite3'
import { config } from 'dotenv'

config({ path: ['.env.local', '.env'] })

const DAYS = Number(process.argv.includes('--days') ? process.argv[process.argv.indexOf('--days') + 1] : 7)
const PAGE_SIZE = 50
const THROTTLE_MS = 500 // pause between pages to stay under RU budget

const connStr = process.env.COSMOS_CONNECTION_STRING
if (!connStr) {
  console.error('COSMOS_CONNECTION_STRING not set')
  process.exit(1)
}

const dbUrl = process.env.DATABASE_URL ?? 'dev.db'
const sqlite = new Database(dbUrl)

// Ensure table exists (matches drizzle/0006_past_betty_ross.sql)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS metric_rollup (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    metric TEXT NOT NULL,
    bucket_key TEXT NOT NULL,
    value REAL NOT NULL,
    period_start INTEGER NOT NULL,
    period_end INTEGER NOT NULL,
    computed_at INTEGER NOT NULL,
    sample_ref TEXT
  )
`)
sqlite.exec(`CREATE INDEX IF NOT EXISTS metric_rollup_metric_period_idx ON metric_rollup(metric, period_end)`)
sqlite.exec(`CREATE INDEX IF NOT EXISTS metric_rollup_metric_bucket_idx ON metric_rollup(metric, bucket_key)`)

const METRIC_KEY = 'tool_payload_size'

const client = new CosmosClient(connStr)
const container = client.database('teammate-service').container('messages')

const now = Math.floor(Date.now() / 1000)
const fromSec = now - DAYS * 86400

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchPaged<T>(
  query: string,
  parameters: { name: string; value: string | number | boolean | null }[],
): Promise<T[]> {
  const iter = container.items.query<T>({ query, parameters }, { maxItemCount: PAGE_SIZE })
  const results: T[] = []
  let page = 0
  while (iter.hasMoreResults()) {
    const { resources } = await iter.fetchNext()
    if (resources) results.push(...resources)
    page++
    if (page % 2 === 0) process.stdout.write('.')
    await sleep(THROTTLE_MS)
  }
  return results
}

async function main() {
  console.log(`Seeding metric_rollup (${METRIC_KEY}) from last ${DAYS} days (throttle=${THROTTLE_MS}ms/page)...`)

  const params = [
    { name: '@fromSec', value: fromSec },
    { name: '@toSec', value: now },
  ]

  // Step 1: functionCall messages → build callId→name map
  process.stdout.write('Fetching functionCall messages')
  const callDocs = await fetchPaged<{ message: string }>(
    `SELECT c.message FROM c
     WHERE c.type = "ChatMessage" AND c.role = "assistant"
       AND c.timestamp > @fromSec AND c.timestamp <= @toSec
       AND CONTAINS(c.message, "functionCall")`,
    params,
  )
  console.log(` done (${callDocs.length} docs)`)

  const callIdToName = new Map<string, string>()
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
  console.log(`Mapped ${callIdToName.size} callId→toolName entries`)

  // Step 2: functionResult messages
  process.stdout.write('Fetching functionResult messages')
  const resultDocs = await fetchPaged<{ conversationId: string; message: string; timestamp: number }>(
    `SELECT c.conversationId, c.message, c.timestamp FROM c
     WHERE c.type = "ChatMessage" AND c.role = "tool"
       AND c.timestamp > @fromSec AND c.timestamp <= @toSec
       AND CONTAINS(c.message, "functionResult")`,
    params,
  )
  console.log(` done (${resultDocs.length} docs)`)

  // Step 3: parse and insert into metric_rollup
  const nowMs = Date.now()
  const insert = sqlite.prepare(
    'INSERT INTO metric_rollup (metric, bucket_key, value, period_start, period_end, computed_at, sample_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const insertMany = sqlite.transaction((rows: [string, string, number, number, number, number, string][]) => {
    for (const row of rows) insert.run(...row)
  })

  const rows: [string, string, number, number, number, number, string][] = []
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
        const tsMs = doc.timestamp * 1000
        rows.push([METRIC_KEY, toolName, len, tsMs, tsMs, nowMs, doc.conversationId])
      }
    } catch {
      /* skip */
    }
  }

  insertMany(rows)
  console.log(`\nInserted ${rows.length} rows into metric_rollup`)

  // Summary
  const stats = sqlite
    .prepare(`
    SELECT bucket_key, COUNT(*) as cnt, ROUND(AVG(value)) as avg_size, MAX(value) as max_size
    FROM metric_rollup WHERE metric = ? GROUP BY bucket_key ORDER BY max_size DESC
  `)
    .all(METRIC_KEY) as { bucket_key: string; cnt: number; avg_size: number; max_size: number }[]

  console.log('\n=== Summary ===')
  for (const s of stats) {
    console.log(`${s.bucket_key}  count=${s.cnt}  avg=${s.avg_size}  max=${s.max_size}`)
  }

  sqlite.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
