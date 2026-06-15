import { createServerFn } from '@tanstack/react-start'

export type TeammateEnv = { label: string; baseUrl: string }
export type TeammateRunOptions = { envs: TeammateEnv[]; defaultCompanyId: string | null }

// EXT_TEAMMATE_ENVS = "Local=http://localhost:5065,Dev=https://dev-host"
function parseEnvs(raw: string | undefined): TeammateEnv[] {
  if (!raw) return []
  const envs: TeammateEnv[] = []
  for (const part of raw.split(',')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    const label = part.slice(0, i).trim()
    const baseUrl = part
      .slice(i + 1)
      .trim()
      .replace(/\/$/, '')
    if (label && baseUrl) envs.push({ label, baseUrl })
  }
  return envs
}

export const getTeammateRunOptions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<TeammateRunOptions> => ({
    envs: parseEnvs(process.env.EXT_TEAMMATE_ENVS),
    defaultCompanyId: process.env.EXT_TEAMMATE_COMPANY_ID ?? null,
  }),
)
