import { type ReactNode, useMemo, useState } from 'react'
import { asMessages } from '#/lib/conversation'
import { estimateTokens } from '#/lib/format'
import { formatJson, type JsonValue } from '#/lib/json'
import type { Span } from '#/lib/spans'
import { displayFor } from './shared'

type ContextTab = 'system' | 'agui'

export interface SystemBlock {
  id: string
  title: string
  content: string
  tokens: number
}

interface ToolDef {
  id: string
  name: string
  domain: string
  description: string
  tokens: number
  raw: JsonValue
}

interface ToolGroup {
  domain: string
  tools: ToolDef[]
  tokens: number
}

interface AguiItem {
  id: string
  label: string
  value: string
  tokens: number
}

// Distinguish a real agent system prompt from runtime/state-sync scaffolding
// that AG-UI middleware (e.g. CopilotKit) injects as `role: system` messages
// each turn — JSON state snapshots, "Here is the current state…", summarize
// directives. The two belong in different tabs.
function classifySystemContent(content: string): 'prompt' | 'agui' {
  const trimmed = content.trim()
  if (!trimmed) return 'prompt'
  if (/^[{[]/.test(trimmed)) return 'agui'
  if (/\b(current state|new state|state changes|state in json|state update|summary of the state)\b/i.test(trimmed)) {
    return 'agui'
  }
  return 'prompt'
}

interface SystemHits {
  prompts: SystemBlock[]
  agui: AguiItem[]
}

export function collectSystemHits(spans: Span[]): SystemHits {
  const prompts: SystemBlock[] = []
  const agui: AguiItem[] = []
  const seenPrompt = new Set<string>()
  const seenAgui = new Set<string>()
  for (const span of spans) {
    if (span.operation !== 'chat') continue
    const messages = asMessages(span.llmInput).filter((message) => message.role === 'system')
    for (const message of messages) {
      const content = message.parts
        .filter((part) => part.kind === 'text')
        .map((part) => part.content)
        .join('\n\n')
        .trim()
      if (!content) continue
      const kind = classifySystemContent(content)
      if (kind === 'prompt') {
        if (seenPrompt.has(content)) continue
        seenPrompt.add(content)
        prompts.push({
          id: `${span.id}-${prompts.length}`,
          title: span.model ?? displayFor(span).name,
          content,
          tokens: estimateTokens(content),
        })
      } else {
        if (seenAgui.has(content)) continue
        seenAgui.add(content)
        agui.push({
          id: `${span.id}-sys-${agui.length}`,
          label: aguiLabelFor(content),
          value: content,
          tokens: estimateTokens(content),
        })
      }
    }
  }
  return { prompts, agui }
}

function aguiLabelFor(content: string): string {
  const trimmed = content.trim()
  if (/^[{[]/.test(trimmed)) return 'State payload'
  if (/\b(summary of the state|summarize)\b/i.test(trimmed)) return 'Summarize directive'
  if (/\b(new state|state changes|state update)\b/i.test(trimmed)) return 'State update directive'
  if (/\b(current state|state in json)\b/i.test(trimmed)) return 'State directive'
  return 'Directive'
}

export function collectToolGroups(spans: Span[]): ToolGroup[] {
  const byKey = new Map<string, ToolDef>()
  for (const span of spans) {
    if (span.operation !== 'chat' || span.toolDefinitions == null) continue
    for (const raw of flattenToolDefinitions(span.toolDefinitions)) {
      const name = toolName(raw)
      const description = toolDescription(raw)
      const domain = toolDomain(raw, name)
      const text = formatJson(raw)
      const key = `${domain}:${name}:${description}`
      if (byKey.has(key)) continue
      byKey.set(key, {
        id: key,
        name,
        domain,
        description,
        tokens: estimateTokens(text),
        raw,
      })
    }
  }

  const groups = new Map<string, ToolDef[]>()
  for (const tool of byKey.values()) {
    const tools = groups.get(tool.domain) ?? []
    tools.push(tool)
    groups.set(tool.domain, tools)
  }
  return [...groups.entries()]
    .map(([domain, tools]) => ({
      domain,
      tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
      tokens: tools.reduce((sum, tool) => sum + tool.tokens, 0),
    }))
    .sort((a, b) => b.tokens - a.tokens || a.domain.localeCompare(b.domain))
}

function collectAguiItems(spans: Span[], extra: AguiItem[]): AguiItem[] {
  const items: AguiItem[] = []
  const sessionIds = new Set(spans.map((span) => span.sessionId).filter((id): id is string => !!id))
  for (const id of sessionIds) {
    items.push({
      id: `session-${id}`,
      label: 'Session / thread id',
      value: id,
      tokens: estimateTokens(id),
    })
  }

  const seen = new Set<string>()
  for (const span of spans) {
    if (span.operation !== 'chat') continue
    for (const hit of findAguiValues(span.llmInput)) {
      const key = `${hit.label}:${hit.value}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        id: `${span.id}-${items.length}`,
        label: hit.label,
        value: hit.value,
        tokens: estimateTokens(hit.value),
      })
    }
  }
  for (const item of extra) {
    const key = `${item.label}:${item.value}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  return items
}

function flattenToolDefinitions(value: JsonValue): JsonValue[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    if (Array.isArray(value.tools)) return value.tools
    if (Array.isArray(value.functions)) return value.functions
  }
  return [value]
}

function toolName(value: JsonValue): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'tool'
  const fn = value.function
  if (fn && typeof fn === 'object' && !Array.isArray(fn) && typeof fn.name === 'string') return fn.name
  if (typeof value.name === 'string') return value.name
  if (typeof value.title === 'string') return value.title
  return 'tool'
}

function toolDescription(value: JsonValue): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const fn = value.function
  if (fn && typeof fn === 'object' && !Array.isArray(fn) && typeof fn.description === 'string') return fn.description
  if (typeof value.description === 'string') return value.description
  return ''
}

function toolDomain(value: JsonValue, name: string): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['domain', 'namespace', 'server', 'mcp_server', 'provider']) {
      const candidate = value[key]
      if (typeof candidate === 'string' && candidate) return candidate
    }
  }
  const [prefix] = name.split(/[.:/_-]/)
  return prefix && prefix !== name ? prefix : 'default'
}

function findAguiValues(value: JsonValue | undefined, path: string[] = []): { label: string; value: string }[] {
  if (value == null) return []
  if (typeof value !== 'object') {
    const label = path.join('.')
    if (/(^|\.)(ag_ui|agui|thread|runtime|context|state)(\.|$)/i.test(label)) {
      return [{ label, value: String(value) }]
    }
    return []
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findAguiValues(item, [...path, String(index)]))
  }
  const out: { label: string; value: string }[] = []
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key]
    const keyLooksRelevant = /(ag_ui|agui|thread|runtime|context|state)/i.test(key)
    if (keyLooksRelevant) {
      out.push({ label: nextPath.join('.'), value: formatJson(child) })
    } else {
      out.push(...findAguiValues(child, nextPath))
    }
  }
  return out
}

export function SessionContextView({ spans }: { spans: Span[] }) {
  const [tab, setTab] = useState<ContextTab>('system')
  const systemHits = useMemo(() => collectSystemHits(spans), [spans])
  const systemBlocks = systemHits.prompts
  const aguiItems = useMemo(() => collectAguiItems(spans, systemHits.agui), [spans, systemHits.agui])
  const systemTokens = systemBlocks.reduce((sum, block) => sum + block.tokens, 0)
  const aguiTokens = aguiItems.reduce((sum, item) => sum + item.tokens, 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-zinc-950/10 border-b px-4 pt-2 dark:border-white/10">
        <div className="text-xs font-semibold text-zinc-950 dark:text-white">Context</div>
        <nav className="mt-1 flex gap-4" aria-label="Session context">
          {(
            [
              ['system', `System ${systemTokens ? `(${systemTokens.toLocaleString()})` : ''}`],
              ['agui', `AG-UI ${aguiTokens ? `(${aguiTokens.toLocaleString()})` : ''}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={[
                'flex h-7 items-center border-b-2 px-0 text-xs font-medium transition-colors',
                tab === id
                  ? 'border-zinc-950 text-zinc-950 dark:border-white dark:text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        {tab === 'system' ? <ContextSystem blocks={systemBlocks} /> : <ContextAgui items={aguiItems} />}
      </div>
    </div>
  )
}

export function ContextSystem({ blocks }: { blocks: SystemBlock[] }) {
  if (blocks.length === 0) return <ContextEmpty>No system prompt found in chat span inputs.</ContextEmpty>
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => (
        <details
          key={block.id}
          open={index === 0}
          className="rounded-lg bg-zinc-950/[0.025] ring-1 ring-zinc-950/10 dark:bg-white/[0.03] dark:ring-white/10"
        >
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-900 dark:text-zinc-100">
            <span>{block.title}</span>
            <span className="ml-2 text-zinc-500 dark:text-zinc-400">{block.tokens.toLocaleString()} est. tokens</span>
          </summary>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words border-zinc-950/10 border-t px-3 py-2 text-[11px] leading-relaxed text-zinc-800 dark:border-white/10 dark:text-zinc-200">
            {block.content}
          </pre>
        </details>
      ))}
    </div>
  )
}

export function ContextTools({ groups }: { groups: ToolGroup[] }) {
  if (groups.length === 0) return <ContextEmpty>No tool definitions found in chat span inputs.</ContextEmpty>
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <details
          key={group.domain}
          className="rounded-lg bg-zinc-950/[0.025] ring-1 ring-zinc-950/10 dark:bg-white/[0.03] dark:ring-white/10"
        >
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-900 dark:text-zinc-100">
            <span>{group.domain}</span>
            <span className="ml-2 text-zinc-500 dark:text-zinc-400">
              {group.tools.length} tools · {group.tokens.toLocaleString()} est. tokens
            </span>
          </summary>
          <div className="divide-y divide-zinc-950/10 border-zinc-950/10 border-t dark:divide-white/10 dark:border-white/10">
            {group.tools.map((tool) => (
              <details key={tool.id} className="group">
                <summary className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-xs">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">{tool.name}</span>
                    {tool.description && (
                      <span className="mt-0.5 block truncate text-zinc-500 dark:text-zinc-400">{tool.description}</span>
                    )}
                  </span>
                  <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                    {tool.tokens.toLocaleString()} tok
                  </span>
                </summary>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-white/70 px-3 py-2 text-[11px] leading-snug text-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-200">
                  {formatJson(tool.raw)}
                </pre>
              </details>
            ))}
          </div>
        </details>
      ))}
    </div>
  )
}

function isShortValue(value: string): boolean {
  return !value.includes('\n') && value.length < 120
}

function ContextAgui({ items }: { items: AguiItem[] }) {
  if (items.length === 0) return <ContextEmpty>No AG-UI/runtime context detected in this session.</ContextEmpty>
  const identifiers = items.filter((item) => isShortValue(item.value))
  const payloads = items.filter((item) => !isShortValue(item.value))
  return (
    <div className="space-y-4">
      {identifiers.length > 0 && (
        <dl className="overflow-hidden rounded-lg ring-1 ring-zinc-950/10 dark:ring-white/10">
          {identifiers.map((item, i) => (
            <div
              key={item.id}
              className={[
                'grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-4 px-3 py-1.5 text-xs',
                i > 0 ? 'border-zinc-950/5 border-t dark:border-white/5' : '',
              ].join(' ')}
            >
              <dt className="text-zinc-500 dark:text-zinc-400">{item.label}</dt>
              <dd className="truncate font-mono text-zinc-900 dark:text-zinc-100" title={item.value}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {payloads.length > 0 && (
        <div className="space-y-2">
          {payloads.map((item) => (
            <details
              key={item.id}
              className="rounded-lg bg-zinc-950/[0.025] ring-1 ring-zinc-950/10 dark:bg-white/[0.03] dark:ring-white/10"
            >
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                <span>{item.label}</span>
                <span className="ml-auto text-zinc-500 dark:text-zinc-400">
                  {item.tokens.toLocaleString()} est. tokens
                </span>
              </summary>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-zinc-950/10 border-t px-3 py-2 text-[11px] leading-snug text-zinc-800 dark:border-white/10 dark:text-zinc-200">
                {item.value}
              </pre>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

function ContextEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[12rem] items-center justify-center rounded-lg border border-dashed border-zinc-950/15 px-4 text-center text-xs text-zinc-400 dark:border-white/15 dark:text-zinc-600">
      {children}
    </div>
  )
}
