// Mints and refreshes a Teammate (Paycor) user access token via the password /
// refresh_token grants. Null when EXT_TEAMMATE_* isn't set.

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

interface TokenConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
  username: string
  password: string
}

function readConfig(): TokenConfig | null {
  const tokenUrl = process.env.EXT_TEAMMATE_TOKEN_URL
  const clientId = process.env.EXT_TEAMMATE_CLIENT_ID
  const clientSecret = process.env.EXT_TEAMMATE_CLIENT_SECRET
  const username = process.env.EXT_TEAMMATE_USERNAME
  const password = process.env.EXT_TEAMMATE_PASSWORD
  if (!tokenUrl || !clientId || !clientSecret || !username || !password) return null
  return { tokenUrl, clientId, clientSecret, username, password }
}

/** True when the Paycor token-exchange env vars are all set. */
export function isTeammateTokenConfigured(): boolean {
  return readConfig() !== null
}

// Refresh tokens rotate, so concurrent refreshes would invalidate each other;
// all acquisition funnels through one in-flight promise.
let _cache: { accessToken: string; refreshToken: string | null; expiresAt: number } | null = null
let _inFlight: Promise<string | null> | null = null

const SKEW_MS = 60_000

async function postForm(url: string, params: Record<string, string>): Promise<TokenResponse | null> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) return null
  return (await res.json()) as TokenResponse
}

function store(resp: TokenResponse | null): string | null {
  if (!resp?.access_token) return null
  const ttlSeconds = typeof resp.expires_in === 'number' ? resp.expires_in : 600
  _cache = {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token ?? _cache?.refreshToken ?? null,
    expiresAt: Date.now() + Math.max(0, ttlSeconds * 1000 - SKEW_MS),
  }
  return _cache.accessToken
}

async function acquire(cfg: TokenConfig): Promise<string | null> {
  // Prefer the rotating refresh token; fall back to a fresh password grant.
  if (_cache?.refreshToken) {
    const refreshed = store(
      await postForm(cfg.tokenUrl, {
        grant_type: 'refresh_token',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: _cache.refreshToken,
      }),
    )
    if (refreshed) return refreshed
  }
  return store(
    await postForm(cfg.tokenUrl, {
      grant_type: 'password',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      username: cfg.username,
      password: cfg.password,
    }),
  )
}

/**
 * Returns a valid Teammate access token, refreshing or re-authenticating as
 * needed. Concurrent callers share one in-flight acquisition so the rotating
 * refresh token isn't spent twice. Null when unconfigured or auth fails.
 */
export async function getTeammateAccessToken(): Promise<string | null> {
  const cfg = readConfig()
  if (!cfg) return null
  if (_cache && Date.now() < _cache.expiresAt) return _cache.accessToken
  if (_inFlight) return _inFlight
  _inFlight = acquire(cfg).finally(() => {
    _inFlight = null
  })
  return _inFlight
}
