import { useQuery } from '@tanstack/react-query'
import { JsonView } from '#/components/ai-elements/json-view'
import { resolveTruncatedAttr } from '#/features/inspect/server/enrich-span'
import type { Span, TruncatableField } from '#/lib/spans'
import { fmtNum } from './shared'

const LABELS: Record<TruncatableField, string> = {
  llmInput: 'Input messages',
  llmOutput: 'Output messages',
  toolDefinitions: 'Tool definitions',
  systemInstructions: 'System instructions',
  toolResult: 'Tool result',
  inputParams: 'Input parameters',
}

interface Props {
  span: Span
  field: TruncatableField
  tokens?: number
}

// For fields no source can recover (system instructions, tool definitions —
// only ever on the truncated chat-span attr). A quiet note, no enrichment call.
export function TruncatedAttrNote({ field }: { field: TruncatableField }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
      {LABELS[field]} truncated at ~8 KB — full value not retained in telemetry.
    </div>
  )
}

export function TruncatedAttrFallback({ span, field, tokens }: Props) {
  const label = LABELS[field]
  const { data, isPending } = useQuery({
    queryKey: ['enrich-span', span.id, field],
    queryFn: () =>
      resolveTruncatedAttr({
        data: {
          spanId: span.id,
          traceId: span.traceId,
          sessionId: span.sessionId,
          operation: span.operation,
          toolCallId: span.toolCallId,
          toolName: span.toolName,
          field,
        },
      }),
    staleTime: Infinity,
  })

  if (data != null) {
    return (
      <div className="min-w-0 max-w-full">
        <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>{label}</span>
          <span className="rounded-sm bg-success/15 px-1 py-px text-[10px] font-medium normal-case text-success">
            recovered
          </span>
        </div>
        <JsonView value={data} className="max-h-96" />
      </div>
    )
  }

  return (
    <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
      {label} unavailable — telemetry truncated this value at ~8 KB
      {tokens != null && tokens > 0 ? ` (${fmtNum(tokens)} tokens)` : ''}.{' '}
      {isPending
        ? 'Checking enrichment sources…'
        : 'The full value was never persisted beyond this truncated copy, so it can’t be recovered.'}
    </div>
  )
}
