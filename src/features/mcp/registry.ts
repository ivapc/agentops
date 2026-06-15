import type { McpServerRef, McpTransport, RegistrySource } from './types'

type RawServerRef = {
  id?: unknown
  name?: unknown
  endpoint?: unknown
  url?: unknown
  transport?: unknown
  ownerTeam?: unknown
  owner_team?: unknown
  ownerContact?: unknown
  owner_contact?: unknown
  source?: unknown
}

let registeredSource: RegistrySource | null = null

export function registerRegistrySource(source: RegistrySource): void {
  registeredSource = source
}

export function getRegistrySource(): RegistrySource {
  return registeredSource ?? new EnvRegistrySource()
}

// Fallback — static JSON from env var (useful for local dev without registry access).
class EnvRegistrySource implements RegistrySource {
  name = 'env'

  async listServerRefs(): Promise<McpServerRef[]> {
    const raw = process.env.MCP_REGISTRY_REFS_JSON
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) throw new Error('MCP_REGISTRY_REFS_JSON must be a JSON array')

    return parsed.map((item, index) => normalizeRef(item as RawServerRef, index))
  }
}

function normalizeRef(raw: RawServerRef, index: number): McpServerRef {
  const name = str(raw.name) ?? `server-${index + 1}`
  const endpoint = str(raw.endpoint) ?? str(raw.url)

  return {
    id: str(raw.id) ?? `${str(raw.source) ?? 'env'}:${name}`,
    name,
    endpoint,
    transport: transport(raw.transport),
    ownerTeam: str(raw.ownerTeam) ?? str(raw.owner_team),
    ownerContact: str(raw.ownerContact) ?? str(raw.owner_contact),
    source: str(raw.source) ?? 'env',
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function transport(value: unknown): McpTransport {
  if (value === 'streamable-http' || value === 'sse' || value === 'stdio') return value
  return 'unknown'
}
