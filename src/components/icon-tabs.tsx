import type { ComponentType } from 'react'

export interface IconTab<T extends string> {
  id: T
  label: string
  Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
}

interface IconTabsProps<T extends string> {
  tabs: readonly IconTab<T>[]
  value: T
  onChange: (value: T) => void
  'aria-label': string
  className?: string
}

export function IconTabs<T extends string>({
  tabs,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
}: IconTabsProps<T>) {
  return (
    <nav
      className={['-ml-0.5 flex flex-wrap items-center gap-1', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
    >
      {tabs.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={[
            'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
            value === id
              ? 'bg-zinc-950/[0.06] text-zinc-950 ring-1 ring-zinc-950/10 dark:bg-white/[0.08] dark:text-white dark:ring-white/10'
              : 'text-zinc-500 hover:bg-zinc-950/[0.035] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-white',
          ].join(' ')}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {label}
        </button>
      ))}
    </nav>
  )
}
