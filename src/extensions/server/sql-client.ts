import sql from 'mssql'

/**
 * Shared SQL Server client for extension sources that read the teammate
 * relational stores (e.g. the AgentTasks registry). Lazily initialized from
 * EXT_SQL_CONNECTION_STRING. Returns null when not configured (safe no-op for
 * upstream contributors).
 */

let _pool: sql.ConnectionPool | null | undefined
let _connecting: Promise<sql.ConnectionPool | null> | undefined

export function isSqlConfigured(): boolean {
  return Boolean(process.env.EXT_SQL_CONNECTION_STRING)
}

// The connection string is the ADO.NET form copied from teammate appsettings
// (Server=host,port;Initial Catalog=db;User Id=u;password=p;). node-mssql's own
// parser is finicky about those keys, so map the ones we use into a config.
function parseConfig(connStr: string): sql.config | null {
  const kv = new Map<string, string>()
  for (const part of connStr.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    kv.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim())
  }
  const rawServer = kv.get('server') ?? kv.get('data source')
  const database = kv.get('initial catalog') ?? kv.get('database')
  const user = kv.get('user id') ?? kv.get('uid')
  const password = kv.get('password') ?? kv.get('pwd')
  if (!rawServer || !database || !user || !password) return null
  const [server, port] = rawServer.replace(/^tcp:/i, '').split(',')
  return {
    server,
    port: port ? Number(port) : 1433,
    database,
    user,
    password,
    options: { encrypt: true, trustServerCertificate: false },
  }
}

export async function getSqlPool(): Promise<sql.ConnectionPool | null> {
  if (_pool !== undefined) return _pool
  if (_connecting) return _connecting
  const connStr = process.env.EXT_SQL_CONNECTION_STRING
  const cfg = connStr ? parseConfig(connStr) : null
  if (!cfg) {
    _pool = null
    return null
  }
  _connecting = new sql.ConnectionPool(cfg)
    .connect()
    .then((pool) => {
      _pool = pool
      return pool
    })
    .catch((e) => {
      console.error('[extensions/sql-client] connect failed:', e)
      _pool = null
      return null
    })
    .finally(() => {
      _connecting = undefined
    })
  return _connecting
}
