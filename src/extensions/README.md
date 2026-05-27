# Extensions — Fork-Local Adapter Layer

This directory is the **isolated integration point** between the upstream agentops
codebase and our own backends (Cosmos DB, SQL Server, etc.). It exists only in
this fork and must never be upstreamed.

## Why

App Insights truncates `customDimensions` values at 8192 characters. For spans
with large payloads (e.g. a 12k-token LLM prompt), the `gen_ai.input.messages`
attribute is stored as truncated, invalid JSON that agentops can't parse.

Rather than patching the upstream telemetry pipeline (which would create merge
conflicts on every sync), we keep a parallel data-fetch path that queries our
own stores — where the data lives untruncated.

## Pattern

```
src/extensions/
  types.ts                     # Shared types (SpanEnrichment, inputs)
  index.ts                     # Barrel re-exports
  server/
    enrich-span.ts             # TanStack Start server function → Cosmos/SQL
  hooks/
    use-span-enrichment.ts     # React Query hook (lazy, gated)
```

**Server functions** (`server/`) run server-side only. They read `EXT_*` env
vars and call external stores. They return typed enrichment payloads or `null`
(no-op when env isn't configured — safe for upstream contributors).

**Hooks** (`hooks/`) are the client-side integration surface. They wrap server
functions with React Query and are gated — only fire when the telemetry data
is detectably incomplete (e.g. missing `llmInput` but tokens are present).

## Integration touchpoints

Only **one** upstream file is modified:

- `src/components/inspect/detail-panel.tsx` — imports `useSpanEnrichment` and
  uses enrichment data as override when the telemetry provider's data is
  truncated. ~5 lines added.

## Adding new enrichments

1. Add fields to `SpanEnrichment` in `types.ts`.
2. Add a query function or expand `enrich-span.ts` to fetch the new data.
3. Consume in the relevant UI component via the hook.

## Env vars

All secrets live in the root `.env` (gitignored) under the `EXT_` prefix:

```env
EXT_COSMOS_ENDPOINT=https://....documents.azure.com:443/
EXT_COSMOS_KEY=<master-key-or-resource-token>
EXT_COSMOS_DATABASE=teammate-service
# Future:
# EXT_SQL_CONNECTION_STRING=Server=...;Database=...;
```

When `EXT_COSMOS_ENDPOINT` is unset, the server function returns `null` — the
app works identically to upstream with no enrichment overlay.

## Merge safety

- `src/extensions/` does not exist upstream → zero merge conflicts here.
- The detail-panel integration is a single hook call + conditional render;
  easy to rebase if upstream restructures that component.
- No upstream imports point into `src/extensions/`.
