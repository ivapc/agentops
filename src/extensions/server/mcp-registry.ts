import { AzureNamedKeyCredential, TableClient } from '@azure/data-tables'
import type { McpServerRef, RegistrySource } from '#/features/mcp'

export function isAzureTableRegistryConfigured(): boolean {
  return Boolean(process.env.EXT_MCP_REGISTRY_ACCOUNT_NAME && process.env.EXT_MCP_REGISTRY_ACCOUNT_KEY)
}

export class AzureTableRegistrySource implements RegistrySource {
  name = 'azure-table'

  async listServerRefs(): Promise<McpServerRef[]> {
    const accountName = process.env.EXT_MCP_REGISTRY_ACCOUNT_NAME ?? ''
    const accountKey = process.env.EXT_MCP_REGISTRY_ACCOUNT_KEY ?? ''
    const tableName = process.env.EXT_MCP_REGISTRY_TABLE_NAME ?? 'McpServerRegistry'

    const credential = new AzureNamedKeyCredential(accountName, accountKey)
    const url = `https://${accountName}.table.core.windows.net`
    const client = new TableClient(url, tableName, credential)

    const refs: McpServerRef[] = []
    for await (const entity of client.listEntities()) {
      const name = str(entity.ServerName) ?? str(entity.rowKey) ?? 'unknown'
      const baseUrl = str(entity.BaseUrl)
      const endpoint = baseUrl?.replace(/\/$/, '') ?? undefined

      refs.push({
        id: `azure-table:${str(entity.rowKey) ?? name}`,
        name,
        endpoint,
        transport: 'streamable-http',
        ownerTeam: str(entity.Domain),
        source: 'azure-table',
        domain: str(entity.Domain),
        description: str(entity.Description),
        healthStatus: str(entity.HealthStatus),
        isEnabled: entity.IsEnabled === true,
        isSubAgent: entity.IsSubAgent === true,
        lastHeartbeat: str(entity.LastHeartbeat),
      })
    }
    return refs
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
