import { MagnifyingGlassIcon } from '@heroicons/react/16/solid'

interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

// Toolbar-sized search input. Catalyst's <Input> is form-height (~36px) which
// dwarfs the h-8 BadgeSelects sitting beside it on filter rows, so this is a
// slim variant that re-uses Catalyst's colour tokens.
export function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  return (
    <div className="relative w-full min-w-0 sm:w-64">
      <MagnifyingGlassIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-500 dark:text-zinc-400"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full appearance-none rounded-md border border-zinc-950/10 bg-white py-1 pr-2.5 pl-8 text-sm text-zinc-950 shadow-xs placeholder:text-zinc-500 hover:border-zinc-950/20 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-500/80 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:shadow-none dark:hover:border-white/20"
      />
    </div>
  )
}
