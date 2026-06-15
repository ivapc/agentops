// Caller for the company-scoped Teammate chat endpoint
// (POST /api/companies/{companyId}/chat), carrying a user bearer. The agent owns
// model/prompt/tools, so dataset overrides don't apply here.
import { randomUUID } from 'node:crypto'

import { isTeammateChatEndpoint } from '../teammate-endpoint'
import { getTeammateAccessToken } from './teammate-token'

type ChatInputMessage = { role: string; content: string }
type ChatInput = string | ChatInputMessage[]

export type TeammateChatInput = {
  endpointUrl: string
  input: ChatInput
  conversationId?: string | null
}

// Mirrors AgentCallResult in agent-run.ts so this is a drop-in for the runner.
export type TeammateChatResult = {
  text: string
  durationMs: number
  rawJson: string
  tokens: number
  inputTokens: number | null
  outputTokens: number | null
}

function toMessages(input: ChatInput): { role: string; text: string; createdAt: string }[] {
  const createdAt = new Date().toISOString()
  if (typeof input === 'string') return [{ role: 'user', text: input, createdAt }]
  return input.map((m) => ({ role: m.role, text: m.content, createdAt }))
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function callTeammateChat(call: TeammateChatInput): Promise<TeammateChatResult> {
  const url = call.endpointUrl.trim()
  if (!isTeammateChatEndpoint(url)) {
    throw new Error(`Not a Teammate chat endpoint: ${url}`)
  }
  const token = await getTeammateAccessToken()
  if (!token) {
    throw new Error('Unable to obtain a Teammate access token (check EXT_TEAMMATE_* credentials)')
  }

  // conversationId is the key loupe groups traces on; the agent echoes it back as threadId.
  const threadId = call.conversationId?.trim() || randomUUID()
  const body = { threadId, messages: toMessages(call.input) }

  const start = performance.now()
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw new Error('Run timed out after 120s')
    throw new Error(err instanceof Error ? err.message : 'Network error')
  }
  const durationMs = Math.round(performance.now() - start)
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Teammate run failed (${response.status}): ${errorText || response.statusText}`)
  }

  const raw = (await response.json()) as Record<string, unknown>
  const usage = (raw.usage ?? {}) as Record<string, unknown>
  const inputTokens = num(usage.inputTokens)
  const outputTokens = num(usage.outputTokens)
  const tokens = num(usage.totalTokens) ?? (inputTokens ?? 0) + (outputTokens ?? 0)
  return {
    text: typeof raw.text === 'string' ? raw.text : '',
    durationMs,
    rawJson: JSON.stringify(raw, null, 2),
    tokens,
    inputTokens,
    outputTokens,
  }
}
