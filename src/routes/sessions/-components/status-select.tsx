import { BadgeSelect } from '#/components/badge-select'

export type StatusFilter = 'all' | 'ok' | 'error'

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  ok: 'OK',
  error: 'Error',
}

const STATUS_OPTIONS: readonly StatusFilter[] = ['all', 'ok', 'error']

export function parseStatusFilter(value: unknown): Exclude<StatusFilter, 'all'> | undefined {
  return value === 'ok' || value === 'error' ? value : undefined
}

interface StatusSelectProps {
  value: StatusFilter
  onChange: (value: StatusFilter) => void
}

export function StatusSelect({ value, onChange }: StatusSelectProps) {
  return (
    <BadgeSelect
      label="Status"
      value={value}
      options={STATUS_OPTIONS}
      onChange={onChange}
      format={(v) => STATUS_LABEL[v]}
    />
  )
}
