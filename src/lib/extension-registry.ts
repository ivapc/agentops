import type { JsonValue } from './json'
import type { Operation, TruncatableField } from './spans'
import type { ToolPayloadRow, TopOpts } from './telemetry/types'

export interface EnrichSpanRequest {
  spanId: string
  traceId: string
  sessionId?: string
  operation: Operation
  field: TruncatableField
}

// A fork registers one Extension at boot to supply data the active telemetry
// provider can't (e.g. from Cosmos, past the App Insights 8 KB truncation).
// Every capability is optional and returns null when it has nothing; consumers
// take the first non-null in registration order. Upstream ships none.
export interface Extension {
  name: string
  resolveTruncatedAttr?(req: EnrichSpanRequest): Promise<JsonValue | string | null>
  toolPayloadSizes?(opts?: TopOpts): Promise<ToolPayloadRow[] | null>
}

const extensions: Extension[] = []

export function registerExtension(ext: Extension): void {
  extensions.push(ext)
}

export function getExtensions(): readonly Extension[] {
  return extensions
}
