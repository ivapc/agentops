import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { Input } from '#/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select'

import { getTeammateRunOptions } from '../server/teammate-options'
import { buildTeammateChatUrl, parseTeammateChatUrl } from '../teammate-endpoint'

const runOptionsQuery = { queryKey: ['teammate', 'run-options'], queryFn: () => getTeammateRunOptions() }

/** True when EXT_TEAMMATE_ENVS is configured, so the picker (not the raw URL box) drives the endpoint. */
export function useTeammateEnvsConfigured(): boolean {
  const { data } = useQuery(runOptionsQuery)
  return (data?.envs.length ?? 0) > 0
}

// Env dropdown + company id that compose the company-scoped Teammate chat URL and
// write it into the endpoint the runner uses. Renders nothing when no envs are
// configured, so without the fork the upstream URL box shows as normal.
export function TeammateEndpointPicker({
  value,
  onChange,
  onCommit,
}: {
  value: string
  onChange: (url: string) => void
  onCommit: () => void
}) {
  const { data } = useQuery(runOptionsQuery)
  const envs = data?.envs ?? []

  const [baseUrl, setBaseUrl] = useState('')
  const [companyId, setCompanyId] = useState('')
  const seeded = useRef(false)

  // Seed once from the saved endpoint (or env defaults) and push the composed URL up,
  // so the field reflects the real target instead of the stale hardcoded default.
  useEffect(() => {
    if (!envs.length || seeded.current) return
    seeded.current = true
    const current = parseTeammateChatUrl(value)
    const base = current?.baseUrl ?? envs[0].baseUrl
    const company = current?.companyId ?? data?.defaultCompanyId ?? ''
    setBaseUrl(base)
    setCompanyId(company)
    if (base && company) {
      const url = buildTeammateChatUrl(base, company)
      if (url !== value) onChange(url)
    }
  }, [envs.length, value, data?.defaultCompanyId, onChange, envs[0]?.baseUrl])

  if (!envs.length) return null

  const apply = (nextBase: string, nextCompany: string) => {
    setBaseUrl(nextBase)
    setCompanyId(nextCompany)
    if (nextBase && nextCompany) {
      onChange(buildTeammateChatUrl(nextBase, nextCompany))
      onCommit()
    }
  }

  return (
    <>
      <Select value={baseUrl} onValueChange={(v) => apply(v, companyId)}>
        <SelectTrigger size="sm" className="w-28 text-xs" aria-label="Environment">
          <SelectValue placeholder="Environment" />
        </SelectTrigger>
        <SelectContent>
          {envs.map((e) => (
            <SelectItem key={e.baseUrl} value={e.baseUrl} className="text-xs">
              {e.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={companyId}
        onChange={(e) => apply(baseUrl, e.target.value.trim())}
        placeholder="Company id"
        aria-label="Company id"
        className="h-8 w-28 font-mono text-xs"
      />
      <span className="truncate font-mono text-xs text-muted-foreground" title={value}>
        {baseUrl && companyId ? `→ /api/companies/${companyId}/chat` : ''}
      </span>
    </>
  )
}
