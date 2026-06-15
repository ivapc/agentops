/**
 * Types for teammate's AgentTasks relational stores. These are the system of
 * record — they survive telemetry sampling/retention, so loupe surfaces them
 * alongside (and as a fallback for) OTel-derived task data.
 */

/**
 * A task from teammate's AgentTasks registry, with lifetime run stats joined
 * from AgentTaskRuns. `id` is lower-cased to match the OTel `task.id` attribute
 * (Guid.ToString()), which the /tasks rollup keys on.
 */
export interface AgentTaskRegistryEntry {
  id: string
  name: string
  status: 'active' | 'paused' | string
  ownerUserId: string
  companyId: number
  threadId?: string
  createdAtMs: number
  updatedAtMs: number
  totalRuns?: number
  succeededRuns?: number
  lastRunStatus?: string
  lastRunError?: string | null
  lastRunAtMs?: number
  // Last run's trigger origin (AgentTaskRuns.Source) — lets the dev match a task
  // to the trigger that fired it. Kind ∈ Schedule|WorkflowEvent|Channel|ChainStep.
  triggerSourceKind?: string
  triggerSourceRef?: string
  triggerRecurring?: boolean
  // Event-trigger definition (EventTriggers) — present for event tasks regardless
  // of run history. `eventFilters` is the raw Filters JSON ({"field":"value"}).
  eventType?: string
  eventTriggerType?: string // Standing (recurring) | OneShot
  eventFilters?: string
}

/**
 * One row from AgentTaskRuns — an authoritative record of a single fire,
 * independent of telemetry. Used to populate the fires table when the exported
 * spans can't be matched to the task (e.g. missing `task.id`).
 */
export interface AgentTaskRun {
  id: string
  status: string
  startedAtMs: number
  durationMs: number
  error?: string | null
}
