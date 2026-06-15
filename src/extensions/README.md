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

- `src/components/inspect/detail-panel.tsx` — imports `useSpanEnrichment` and
  uses enrichment data as override when the telemetry provider's data is
  truncated. ~5 lines added.
- `src/features/tasks/` — the `/tasks` rollup left-joins the SQL `AgentTasks`
  registry + `AgentTaskRuns` lifetime stats (`fetchAgentTaskRegistry` →
  `mergeTaskRegistry`) so paused / never-fired tasks and authoritative all-time
  run counts surface alongside telemetry-derived rows. OTel still owns the
  window-scoped metrics; the DB owns identity, status, and run history. No-op
  when `EXT_SQL_CONNECTION_STRING` is unset.
- `src/features/evaluation/server/datasets.ts` — `/datasets` runs switch to the
  authenticated, company-scoped Teammate chat endpoint
  (`/api/companies/{id}/chat`) when the run URL matches that shape: `callTeammateChat`
  mints a real user token (Paycor password/refresh grant, `teammate-token.ts`) and
  posts there; otherwise the upstream `callAgent` runs. The `TeammateEndpointPicker`
  (env dropdown + company id) composes that URL in the run bar. No-op when
  `EXT_TEAMMATE_*` is unset.

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
EXT_SQL_CONNECTION_STRING=Server=host,1433;Initial Catalog=db;User Id=u;password=p;

# Teammate /datasets target — env dropdown + user-token auth for chat-endpoint runs
EXT_TEAMMATE_ENVS=Local=http://localhost:5065,Dev=https://<dev-host>
EXT_TEAMMATE_COMPANY_ID=<default company id the user has Teammate access to>
EXT_TEAMMATE_TOKEN_URL=https://<paycor-secure-host>/accounts/api/v2/authtoken
EXT_TEAMMATE_CLIENT_ID=TeammateService
EXT_TEAMMATE_CLIENT_SECRET=<secret>
EXT_TEAMMATE_USERNAME=<user>
EXT_TEAMMATE_PASSWORD=<pass>
```

When `EXT_COSMOS_ENDPOINT` / `EXT_SQL_CONNECTION_STRING` are unset, the relevant
source returns `null`/`[]` — the app works identically to upstream with no
enrichment overlay.

## Merge safety

- `src/extensions/` does not exist upstream → zero merge conflicts here.
- The detail-panel integration is a single hook call + conditional render;
  easy to rebase if upstream restructures that component.
- No upstream imports point into `src/extensions/`.
