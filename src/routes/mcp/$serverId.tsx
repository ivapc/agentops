import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Wrench } from 'lucide-react'
import { Page } from '#/components/page'
import { Badge } from '#/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '#/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { mcpQuery } from './-data'

export const Route = createFileRoute('/mcp/$serverId')({
  loader: ({ context }) => context.queryClient.ensureQueryData(mcpQuery()),
  component: McpServerPage,
})

function McpServerPage() {
  const { serverId } = Route.useParams()
  const { data } = useQuery(mcpQuery())
  const server = data?.servers.find((s) => s.id === serverId)

  if (!server) {
    return (
      <Page title="MCP Server">
        <div className="px-4 lg:px-6">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Server not found</EmptyTitle>
              <EmptyDescription>No server matched "{serverId}".</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </Page>
    )
  }

  const findings = data?.findings?.filter((f) => f.serverId === server.id) ?? []

  return (
    <Page
      title={server.name}
      actions={
        <Link to="/mcp" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          All servers
        </Link>
      }
    >
      <div className="flex flex-col gap-6 px-4 lg:px-6">
        {/* Server metadata */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          {server.endpoint && (
            <>
              <dt className="text-muted-foreground">Endpoint</dt>
              <dd className="font-mono">{server.endpoint}</dd>
            </>
          )}
          {server.domain && (
            <>
              <dt className="text-muted-foreground">Domain</dt>
              <dd>{server.domain}</dd>
            </>
          )}
          {server.ownerTeam && (
            <>
              <dt className="text-muted-foreground">Owner</dt>
              <dd>{server.ownerTeam}</dd>
            </>
          )}
          {server.description && (
            <>
              <dt className="text-muted-foreground">Description</dt>
              <dd>{server.description}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <Badge
              variant={
                server.fetchStatus === 'ok' ? 'success' : server.fetchStatus === 'error' ? 'destructive' : 'secondary'
              }
            >
              {server.fetchStatus}
            </Badge>
            {server.fetchError && <span className="ml-2 text-xs text-destructive">{server.fetchError}</span>}
          </dd>
          {server.healthStatus && (
            <>
              <dt className="text-muted-foreground">Health</dt>
              <dd>{server.healthStatus}</dd>
            </>
          )}
          {server.lastHeartbeat && (
            <>
              <dt className="text-muted-foreground">Last heartbeat</dt>
              <dd className="font-mono text-xs">{server.lastHeartbeat}</dd>
            </>
          )}
        </dl>

        {/* Tools table */}
        <div>
          <h2 className="mb-3 text-sm font-medium">
            Tools <span className="text-muted-foreground">({server.tools.length})</span>
          </h2>
          {server.tools.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Wrench aria-hidden />
                </EmptyMedia>
                <EmptyTitle>No tools</EmptyTitle>
                <EmptyDescription>
                  {server.fetchStatus === 'error'
                    ? 'Could not fetch tools from server.'
                    : 'This server reported no tools.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {server.tools.map((tool) => (
                  <TableRow key={tool.id}>
                    <TableCell className="font-mono text-sm">{tool.name}</TableCell>
                    <TableCell className="text-muted-foreground">{tool.description ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Lint findings */}
        {findings.length > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-medium">
              Findings <span className="text-muted-foreground">({findings.length})</span>
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Tool</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {findings.map((f) => (
                  <TableRow key={`${f.ruleId}-${f.toolName ?? ''}-${f.message}`}>
                    <TableCell>
                      <Badge
                        variant={
                          f.severity === 'error' ? 'destructive' : f.severity === 'warning' ? 'warning' : 'secondary'
                        }
                      >
                        {f.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{f.ruleId}</TableCell>
                    <TableCell>{f.message}</TableCell>
                    <TableCell className="font-mono text-xs">{f.toolName ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Page>
  )
}
