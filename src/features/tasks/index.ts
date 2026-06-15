// Pure registry-join helpers live in the extensions adapter, but re-exposed here
// so route components import them without pulling the server-only (mssql/cosmos)
// extensions barrel into the client bundle.
export { mergeTaskRegistry, runsToFires } from '#/extensions/tasks/merge'
export { FiresTable } from './components/fires-table'
export { MetricTiles } from './components/metric-tiles'
export { TaskHero } from './components/task-hero'
export { TasksDataTable } from './components/tasks-table'
export { type TasksData, taskRunsQuery, tasksQuery } from './data'
export { rollupTasks, summarizeRollup, type TaskRow, taskIdentity } from './rollup'
