/**
 * Pure presentation helpers for event-trigger tasks. Lives in the extensions
 * adapter (it knows teammate's EventTriggers shape); the tasks feature imports
 * it for display. No React, no DB.
 */

export interface EventFilter {
  field: string
  value: string
}

export interface EventTriggerView {
  eventType: string
  recurring: boolean
  filters: EventFilter[]
  /** Compact one-liner for the table cell, e.g. "ChangedFields=HomeEmail". */
  filterSummary?: string
  /** Full multi-line detail for a hover tooltip. */
  tooltip: string
}

function parseFilters(raw: string | undefined): EventFilter[] {
  if (!raw) return []
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    return Object.entries(obj).map(([field, value]) => ({ field, value: String(value) }))
  } catch {
    return []
  }
}

// Last dotted segment — "Meta.ChangedFields" → "ChangedFields".
const shortField = (f: string): string => f.split('.').pop() ?? f

export function eventTriggerView(input: {
  eventType?: string
  eventTriggerType?: string
  eventFilters?: string
}): EventTriggerView | null {
  if (!input.eventType) return null
  const recurring = input.eventTriggerType?.toLowerCase() === 'standing'
  const filters = parseFilters(input.eventFilters)
  const filterSummary = filters.length ? filters.map((f) => `${shortField(f.field)}=${f.value}`).join(', ') : undefined

  const lines = [
    `Event: ${input.eventType}`,
    `Type: ${input.eventTriggerType ?? 'event'}${recurring ? ' (recurring)' : ''}`,
  ]
  if (filters.length) {
    lines.push('Filters:')
    for (const f of filters) lines.push(`  ${f.field} = ${f.value}`)
  }

  return { eventType: input.eventType, recurring, filters, filterSummary, tooltip: lines.join('\n') }
}
