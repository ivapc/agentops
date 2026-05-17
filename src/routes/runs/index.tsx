import { PlayCircleIcon } from '@heroicons/react/24/outline'
import { createFileRoute } from '@tanstack/react-router'
import { EmptyState } from '#/components/empty-state'

export const Route = createFileRoute('/runs/')({
  component: RunsLanding,
})

function RunsLanding() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-4">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-white">Runs</h1>
      </div>
      <EmptyState
        icon={PlayCircleIcon}
        title="Nothing running yet"
        description={
          <>
            This section is for single-run views and future live ingestion — watching spans flush from the exporter,
            streaming events from a running app, or starting an agent here. Conversation threads and multi-run grouping
            live under{' '}
            <a href="/sessions" className="font-medium text-accent-600 hover:underline dark:text-accent-400">
              Sessions
            </a>
            .
          </>
        }
      />
    </div>
  )
}
