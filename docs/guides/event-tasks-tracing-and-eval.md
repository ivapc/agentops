---
title: Verify event/scheduled task tracing (teammate OTel changes)
type: guide
summary: Confirm the teammate.api emission changes (early task.id, event-shell
         de-fire, task.kind=event) make /tasks group and label task runs correctly.
status: draft
owner: "@ivan"
audience: loupe-devs
last-reviewed: 2026-06-15
tags: [tasks, otel, teammate, tracing, verification]
---

# Verify event/scheduled task tracing (teammate OTel changes)

## When to use this guide

After teammate.api emits fresh telemetry, to confirm the task-tracing fixes
landed correctly. These are **emission** changes — they only affect *new*
traces, so historical task.id-less runs keep their old shape until they age out
of the query window. Don't judge the fix on old data.

## What changed (and why)

Three teammate.api changes, all in `Features/AgentTasks/`:

1. **`task.id` stamped early** — `TaskRunner.cs` now sets `task.id` next to
   `scheduled_task.agent_task_id` (right after the Quartz activity is grabbed),
   *before* the idempotency / skip / revoke branches in `ExecuteRunAsync`.
   Previously `task.id` was stamped late, so any run that short-circuited
   (idempotency hit, paused, access-revoked) emitted `trigger_type='scheduled'`
   with **no** `task.id` and collapsed into one `derived:Teammate.Service|Teammate|scheduled`
   row (the 311-fire blob).

2. **Event dispatch shell de-fired** — `EventTriggerService.cs` no longer calls
   `SetSessionTrigger(Event)` on the `event_trigger.execute` span. That span only
   schedules the Quartz job; marking it a fire added a second task.id-less
   `event` trace per dispatch, so event tasks "barely appeared" (real runs
   scattered while the shells collapsed).

3. **`task.kind='event'` for all `WorkflowEvent`** — `TaskRunner.cs` no longer
   downgrades one-shot event triggers to `task.kind='one_shot'`.

Loupe side (already shipped): `rollupTasks` drops any `event_trigger.execute`
span as belt-and-suspenders, and the "retried" badge only applies to genuine
`task.id`-identity one-shots.

## Verify

On `/tasks` against fresh telemetry:

1. **No giant derived bucket.** `derived:Teammate.Service|Teammate|scheduled`
   should stop growing; scheduled runs group under `task:<guid>` rows with real
   names. (Search/inspect a known scheduled task — its fires should land on its
   own row, not the derived blob.)
2. **Event tasks present.** Event-triggered tasks appear as their own rows,
   labeled **event** (not one_shot), one row per task — not a single collapsed
   `derived:` event row.
3. **No phantom event fires.** Fire counts for an event task match the number of
   real runs; the `event_trigger.execute` dispatch span no longer shows as a fire.
4. **task.id on short-circuits.** Spot-check an idempotency-hit / skipped run in
   the trace view — its root span should now carry `task.id`.

Raw-attribute spot check (OpenObserve / App Insights): a scheduled run root span
has both `session.trigger_type='scheduled'` **and** `task.id`; an
`event_trigger.execute` span has **no** `session.trigger_type`.

## Related

- `docs/explanation/02-spec.md` — the `task.*` / `session.trigger_type` convention loupe reads.
- `src/features/tasks/rollup.ts` — identity grouping + shell drop + kind derivation.
- teammate.api `Features/AgentTasks/TaskRunner.cs`, `Triggers/EventTriggerService.cs` — emission sites.
