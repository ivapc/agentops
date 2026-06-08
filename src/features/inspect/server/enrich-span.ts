import { createServerFn } from '@tanstack/react-start'
import { registerExtensions } from '#/extensions/server/bootstrap'
import { type EnrichSpanRequest, getExtensions } from '#/lib/extension-registry'
import type { JsonValue } from '#/lib/json'

export type { EnrichSpanRequest }

// Returns the full value of a truncated span attribute from a registered
// extension; null when none can resolve it. First non-null wins.
export const resolveTruncatedAttr = createServerFn({ method: 'POST' })
  .inputValidator((req: EnrichSpanRequest) => req)
  .handler(async ({ data }): Promise<JsonValue | string | null> => {
    registerExtensions()
    for (const ext of getExtensions()) {
      try {
        const result = await ext.resolveTruncatedAttr?.(data)
        if (result != null) return result
      } catch (e) {
        console.error(`[enrich-span] extension ${ext.name} failed:`, e)
      }
    }
    return null
  })
