import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENV = {
  EXT_TEAMMATE_TOKEN_URL: 'https://auth.example/authtoken',
  EXT_TEAMMATE_CLIENT_ID: 'cid',
  EXT_TEAMMATE_CLIENT_SECRET: 'secret',
  EXT_TEAMMATE_USERNAME: 'user',
  EXT_TEAMMATE_PASSWORD: 'pass',
}

function ok(body: Record<string, unknown>) {
  return { ok: true, json: async () => body } as unknown as Response
}

function fail(status: number) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response
}

// Module-level token cache means each test needs a fresh import.
async function freshModule() {
  vi.resetModules()
  return import('./teammate-token')
}

function grant(call: unknown): string {
  const body = (call as [string, { body: URLSearchParams }])[1].body
  return body.get('grant_type') ?? ''
}

describe('getTeammateAccessToken', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) process.env[k] = v
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    for (const k of Object.keys(ENV)) delete process.env[k]
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('mints via the password grant on first call', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'a1', refresh_token: 'r1', expires_in: 600 }))
    const { getTeammateAccessToken } = await freshModule()

    expect(await getTeammateAccessToken()).toBe('a1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(grant(fetchMock.mock.calls[0])).toBe('password')
  })

  it('returns the cached token without re-fetching before expiry', async () => {
    fetchMock.mockResolvedValueOnce(ok({ access_token: 'a1', refresh_token: 'r1', expires_in: 600 }))
    const { getTeammateAccessToken } = await freshModule()

    await getTeammateAccessToken()
    expect(await getTeammateAccessToken()).toBe('a1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes via the refresh_token grant after expiry', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'a1', refresh_token: 'r1', expires_in: 0 }))
      .mockResolvedValueOnce(ok({ access_token: 'a2', refresh_token: 'r2', expires_in: 600 }))
    const { getTeammateAccessToken } = await freshModule()

    expect(await getTeammateAccessToken()).toBe('a1') // expires_in 0 → already stale
    expect(await getTeammateAccessToken()).toBe('a2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(grant(fetchMock.mock.calls[1])).toBe('refresh_token')
    expect(fetchMock.mock.calls[1][1].body.get('refresh_token')).toBe('r1')
  })

  it('falls back to the password grant when the refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ access_token: 'a1', refresh_token: 'r1', expires_in: 0 }))
      .mockResolvedValueOnce(fail(401)) // refresh rejected
      .mockResolvedValueOnce(ok({ access_token: 'a3', refresh_token: 'r3', expires_in: 600 }))
    const { getTeammateAccessToken } = await freshModule()

    expect(await getTeammateAccessToken()).toBe('a1')
    expect(await getTeammateAccessToken()).toBe('a3')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(grant(fetchMock.mock.calls[2])).toBe('password')
  })

  it('shares one in-flight acquisition across concurrent callers', async () => {
    let resolve: (r: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)))
    const { getTeammateAccessToken } = await freshModule()

    const p1 = getTeammateAccessToken()
    const p2 = getTeammateAccessToken()
    resolve(ok({ access_token: 'a1', refresh_token: 'r1', expires_in: 600 }))

    expect(await Promise.all([p1, p2])).toEqual(['a1', 'a1'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns null and never fetches when unconfigured', async () => {
    for (const k of Object.keys(ENV)) delete process.env[k]
    const { getTeammateAccessToken, isTeammateTokenConfigured } = await freshModule()

    expect(isTeammateTokenConfigured()).toBe(false)
    expect(await getTeammateAccessToken()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
