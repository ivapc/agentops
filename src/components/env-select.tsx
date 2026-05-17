import { BadgeSelect } from '#/components/badge-select'

export const ENV_OPTIONS = ['main', 'dev'] as const
export type Env = (typeof ENV_OPTIONS)[number]

interface EnvSelectProps {
  value: Env
  onChange: (value: Env) => void
  options?: readonly Env[]
}

export function EnvSelect({ value, onChange, options = ENV_OPTIONS }: EnvSelectProps) {
  return <BadgeSelect label="Env" value={value} options={options} onChange={onChange} />
}
