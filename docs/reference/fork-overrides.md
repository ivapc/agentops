# Fork overrides

Files in this fork that diverge from upstream agentops.

## Overrides

| File                                      | Change                                                                                                | Why                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/components/inspect/detail-panel.tsx` | `JsonBlock`: unwrap string-valued results that contain JSON and pretty-print via `CodeBlock` | MCP/tool results are double-encoded strings; upstream renders them as raw unformatted text |
| `src/components/ai-elements/tool.tsx`     | `ToolOutput`: try-parse string output as JSON; pretty-print if object/array                 | Same double-encoding issue in the LLM span messages view                                   |
| `src/lib/extension-registry.ts`           | Upstream-owned registry: `Extension` interface (`resolveTruncatedAttr?`, `toolPayloadSizes?`), ships empty | Single seam forks plug into; keeps upstream consumers source-agnostic        |
| `src/features/inspect/server/enrich-span.ts` | `resolveTruncatedAttr` loops `getExtensions()`; side-effect imports the fork bootstrap                | Recover Cosmos values for attrs App Insights truncates at 8192 chars               |
| `src/lib/telemetry/index.ts`              | `listToolPayloadSizes` loops `getExtensions()` for real sizes, falls back to the provider             | Cosmos serves untruncated tool payload sizes past the 8 KB cap                     |
| `src/extensions/` (entire directory)      | Fork-only adapter — Cosmos client + sources; `bootstrap.ts` registers one `cosmosExtension`           | Isolated; does not exist upstream; zero merge conflict risk                        |

## Fork-local attributes

Attributes emitted by the Teammate producer that agentops reads for filtering. Not in upstream spec.

| Attribute          | Values                     | Source                                       | Used for                              |
| ------------------ | -------------------------- | -------------------------------------------- | ------------------------------------- |
| `teammate.channel` | `web` \| `email` \| `m365` | `AgentContextMiddleware` in Teammate.Service | Filter chip on `/sessions`, `/traces` |
