import type { JsonValue } from '#/lib/json'
import { getContainer } from '../cosmos-client'

/**
 * Cosmos DB source — recovers the full untruncated tool *result* from the
 * orchestrator's persisted agent session, where Teammate's ToolDataCapture
 * offloads large payloads. App Insights truncates `gen_ai.tool.call.result`
 * at 8192 chars; sub-agent (MCP) results never reach the `messages` container
 * at all — only a summary + `Captured:` trailer does.
 *
 * `CosmosAgentSessionStore`: container `agent-sessions`, partition `/userId`,
 * document id = AGUI threadId. We don't carry userId on the span, so we query
 * cross-partition by id. Payload lives at
 * `sessionJson.stateBag.tool_data.entries[]` ({ toolName, data, callId }).
 *
 * Returns null when not configured, the session wasn't persisted (e.g. no
 * userId in AgentContext at save time — test/sandbox ingresses), or no entry
 * matches. Only results are stored here, not arguments.
 */

const SESSION_CONTAINERS = ['agent-sessions', 'demo-sessions']

interface ToolDataEntry {
  toolName?: string
  data?: string
  callId?: string
  source?: string
}

interface SessionDoc {
  sessionJson?: { stateBag?: { tool_data?: { entries?: ToolDataEntry[] } } } | string
}

export async function cosmosToolResultFromSession(input: {
  threadId: string
  callId?: string
  toolName?: string
}): Promise<JsonValue | null> {
  const { threadId, callId, toolName } = input
  if (!threadId) return null

  for (const name of SESSION_CONTAINERS) {
    const container = getContainer(name)
    if (!container) continue
    try {
      const { resources } = await container.items
        .query<SessionDoc>({
          query: 'SELECT c.sessionJson FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: threadId }],
        })
        .fetchAll()

      for (const doc of resources) {
        const entries = entriesOf(doc)
        if (!entries.length) continue
        const byCall = callId
          ? entries.find((e) => e.callId && e.callId.toLowerCase() === callId.toLowerCase())
          : undefined
        const byName = !byCall && toolName ? entries.find((e) => e.toolName === toolName) : undefined
        const hit = byCall ?? byName
        if (hit?.data) return parseMaybe(hit.data)
      }
    } catch (e) {
      console.error('[extensions/cosmos-agent-session]', e)
    }
  }
  return null
}

function entriesOf(doc: SessionDoc): ToolDataEntry[] {
  const sj = doc.sessionJson
  const obj = typeof sj === 'string' ? safeParse(sj) : sj
  return obj?.stateBag?.tool_data?.entries ?? []
}

function safeParse(text: string): { stateBag?: { tool_data?: { entries?: ToolDataEntry[] } } } | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseMaybe(data: string): JsonValue {
  try {
    return JSON.parse(data) as JsonValue
  } catch {
    return data
  }
}
