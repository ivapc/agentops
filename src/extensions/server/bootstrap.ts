import { registerEnrichmentSource } from '#/features/inspect/server/enrich-span'
import { registerExtension } from '#/lib/extension-registry'
import { cosmosExtension } from './cosmos-extension'

let done = false

// Idempotent. Call from server-only code paths (not as a module side effect) so
// client bundles reaching this via a server fn can tree-shake the Cosmos SDK out.
export function registerExtensions(): void {
  if (done) return
  done = true
  registerExtension(cosmosExtension)
  // Truncated-attr enrichment goes through upstream's sanctioned hook; the fork
  // registry stays for toolPayloadSizes, which upstream has no hook for.
  const resolve = cosmosExtension.resolveTruncatedAttr
  if (resolve) {
    registerEnrichmentSource({ name: cosmosExtension.name, resolve })
  }
}
