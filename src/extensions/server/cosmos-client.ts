import { type Container, CosmosClient, type Database, type SqlQuerySpec } from '@azure/cosmos'

/**
 * Shared Cosmos client for all extension sources. Lazily initialized from
 * EXT_COSMOS_* or COSMOS_CONNECTION_STRING env vars. Returns null when
 * not configured (safe no-op for upstream contributors).
 */

let _client: CosmosClient | null | undefined
let _db: Database | null | undefined

function getClient(): CosmosClient | null {
  if (_client !== undefined) return _client
  const connStr = process.env.COSMOS_CONNECTION_STRING ?? process.env.EXT_COSMOS_CONNECTION_STRING
  if (connStr) {
    _client = new CosmosClient(connStr)
    return _client
  }
  const endpoint = process.env.EXT_COSMOS_ENDPOINT
  const key = process.env.EXT_COSMOS_KEY
  if (endpoint && key) {
    _client = new CosmosClient({ endpoint, key })
    return _client
  }
  _client = null
  return null
}

function getDatabase(): Database | null {
  if (_db !== undefined) return _db
  const client = getClient()
  if (!client) {
    _db = null
    return null
  }
  const dbName = process.env.EXT_COSMOS_DATABASE ?? 'teammate-service'
  _db = client.database(dbName)
  return _db
}

/** Returns a container handle, or null when Cosmos isn't configured. */
export function getContainer(name: string): Container | null {
  const db = getDatabase()
  return db ? db.container(name) : null
}

// teammate and teammate-2 write conversations to separate mirrored containers;
// a thread lives in exactly one, so the first with rows wins.
const MESSAGE_CONTAINERS = ['messages', 'messages-test']

export async function queryMessages<T>(spec: SqlQuerySpec): Promise<T[]> {
  for (const name of MESSAGE_CONTAINERS) {
    const container = getContainer(name)
    if (!container) continue
    const { resources } = await container.items.query<T>(spec).fetchAll()
    if (resources?.length) return resources
  }
  return []
}

/** Handles for every message container, for callers that page rather than query once. */
export function getMessageContainers(): Container[] {
  return MESSAGE_CONTAINERS.map(getContainer).filter((c): c is Container => c !== null)
}

/** Returns true if Cosmos env vars are set. */
export function isConfigured(): boolean {
  return getClient() !== null
}
