# Fork overrides

Files in this fork that diverge from upstream agentops.

## Overrides

| File                                      | Change                                                                                                | Why                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/components/inspect/detail-panel.tsx` | `JsonBlock`: unwrap string-valued results that contain JSON and pretty-print via `CodeBlock` | MCP/tool results are double-encoded strings; upstream renders them as raw unformatted text |
| `src/components/ai-elements/tool.tsx`     | `ToolOutput`: try-parse string output as JSON; pretty-print if object/array                 | Same double-encoding issue in the LLM span messages view                                   |
| `src/components/inspect/overview.tsx`     | Imports `useToolDefinitionsEnrichment`; `SessionTools` enriches truncated `gen_ai.tool.definitions`   | App Insights truncates at 8192 chars; full tool definitions from Cosmos            |
| `src/lib/telemetry/index.ts`              | `listToolPayloadSizes` calls extensions directly instead of HTTP sidecar                              | Eliminates `TOOL_PAYLOAD_API_URL` / `external/cosmos-payloads/serve.ts`            |
| `src/extensions/` (entire directory)      | Fork-only adapter layer — Cosmos SDK client + sources (`cosmos-messages`, `cosmos-tool-call`) + hooks | Isolated; does not exist upstream; zero merge conflict risk                        |

## Fork-local attributes

Attributes emitted by the Teammate producer that agentops reads for filtering. Not in upstream spec.

| Attribute          | Values                     | Source                                       | Used for                              |
| ------------------ | -------------------------- | -------------------------------------------- | ------------------------------------- |
| `teammate.channel` | `web` \| `email` \| `m365` | `AgentContextMiddleware` in Teammate.Service | Filter chip on `/sessions`, `/traces` |
