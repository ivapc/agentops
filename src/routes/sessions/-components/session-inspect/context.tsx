import { useMemo, useState } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '#/components/ui/accordion'
import { Badge } from '#/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '#/components/ui/empty'
import { ScrollArea } from '#/components/ui/scroll-area'
import { formatJson } from '#/lib/json'
import type { Span } from '#/lib/spans'
import {
  type AguiItem,
  collectAguiItems,
  collectFrontendTools,
  collectSystemHits,
  type FrontendTool,
  isShortValue,
  type SystemBlock,
  type ToolDef,
  type ToolGroup,
} from './context-collectors'

type ContextTab = 'system' | 'agui'

export function SessionContextView({ spans }: { spans: Span[] }) {
  const [tab, setTab] = useState<ContextTab>('system')
  const systemHits = useMemo(() => collectSystemHits(spans), [spans])
  const systemBlocks = systemHits.prompts
  const aguiItems = useMemo(() => collectAguiItems(spans, systemHits.agui), [spans, systemHits.agui])
  const frontendTools = useMemo(() => collectFrontendTools(spans), [spans])
  const systemTokens = systemBlocks.reduce((sum, block) => sum + block.tokens, 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-border border-b px-4 pt-2">
        <div className="text-sm font-semibold text-foreground">Context</div>
        <nav className="mt-1 flex gap-4" aria-label="Session context">
          {(
            [
              ['system', `System ${systemTokens ? `(${systemTokens.toLocaleString()})` : ''}`],
              ['agui', 'AG-UI'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={[
                'flex h-8 items-center border-b-2 px-0 text-sm font-medium transition-colors',
                tab === id
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-4">
          {tab === 'system' ? (
            <ContextSystem blocks={systemBlocks} />
          ) : (
            <ContextAgui items={aguiItems} frontendTools={frontendTools} />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

export function ContextSystem({ blocks }: { blocks: SystemBlock[] }) {
  if (blocks.length === 0) {
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyTitle>No system prompt</EmptyTitle>
          <EmptyDescription>None of the chat spans carry a system message.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <Accordion type="multiple" defaultValue={blocks.length > 0 ? [blocks[0].id] : []}>
      {blocks.map((block) => (
        <AccordionItem key={block.id} value={block.id}>
          <AccordionTrigger>
            <span className="min-w-0 flex-1 truncate">{block.title}</span>
            <Badge variant="secondary" className="tabular-nums">
              {block.tokens.toLocaleString()} tok
            </Badge>
          </AccordionTrigger>
          <AccordionContent>
            <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
              {block.content}
            </pre>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

export function ContextTools({ groups }: { groups: ToolGroup[] }) {
  if (groups.length === 0) {
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyTitle>No tool definitions</EmptyTitle>
          <EmptyDescription>The chat spans didn't advertise any tools.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const wrapped = groups.filter((g) => g.kind !== 'default')
  const flat = groups.find((g) => g.kind === 'default')?.tools ?? []
  return (
    <div className="space-y-3">
      {wrapped.length > 0 && (
        <Accordion type="multiple">
          {wrapped.map((group) => {
            const value = `${group.kind}:${group.domain}`
            return (
              <AccordionItem key={value} value={value}>
                <AccordionTrigger>
                  <span className="min-w-0 flex-1 truncate">{group.domain}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="secondary" className="tabular-nums">
                      {group.tools.length} tool{group.tools.length === 1 ? '' : 's'}
                    </Badge>
                    <Badge variant="outline" className="tabular-nums">
                      {group.tokens.toLocaleString()} tok
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-0">
                  <div className="divide-y divide-border border-border border-t">
                    {group.tools.map((tool) => (
                      <ToolRow key={tool.id} tool={tool} />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}
      {flat.length > 0 && (
        <div className="divide-y divide-border overflow-hidden rounded-md border bg-muted/50">
          {flat.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}

function ToolRow({ tool }: { tool: ToolDef }) {
  return (
    <details className="group">
      <summary className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-xs">
        <span className="min-w-0">
          <span className="block truncate font-medium text-foreground">{tool.name}</span>
          {tool.description && <span className="mt-0.5 block truncate text-muted-foreground">{tool.description}</span>}
        </span>
        <Badge variant="outline" className="tabular-nums">
          {tool.tokens.toLocaleString()} tok
        </Badge>
      </summary>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-card/70 px-3 py-2 text-xs leading-snug text-foreground">
        {formatJson(tool.raw)}
      </pre>
    </details>
  )
}

function ContextAgui({ items, frontendTools }: { items: AguiItem[]; frontendTools: FrontendTool[] }) {
  if (items.length === 0 && frontendTools.length === 0) {
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyTitle>No AG-UI context</EmptyTitle>
          <EmptyDescription>Didn't detect runtime/state context in this session.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const identifiers = items.filter((item) => isShortValue(item.value))
  const payloads = items.filter((item) => !isShortValue(item.value))
  return (
    <div className="space-y-4">
      {frontendTools.length > 0 && <FrontendToolsSection tools={frontendTools} />}

      {identifiers.length > 0 && (
        <dl className="overflow-hidden rounded-lg ring-1 ring-border">
          {identifiers.map((item, i) => (
            <div
              key={item.id}
              className={[
                'grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-4 px-3 py-1.5 text-xs',
                i > 0 ? 'border-border border-t' : '',
              ].join(' ')}
            >
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="truncate font-mono text-foreground" title={item.value}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {payloads.length > 0 && (
        <Accordion type="multiple">
          {payloads.map((item) => (
            <AccordionItem key={item.id} value={item.id}>
              <AccordionTrigger>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <Badge variant="secondary" className="tabular-nums">
                  {item.tokens.toLocaleString()} tok
                </Badge>
              </AccordionTrigger>
              <AccordionContent>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs leading-snug text-foreground">
                  {item.value}
                </pre>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  )
}

function FrontendToolsSection({ tools }: { tools: FrontendTool[] }) {
  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Frontend tools</span>
        <span className="tabular-nums">{tools.length}</span>
      </header>
      <div className="divide-y divide-border overflow-hidden rounded-lg ring-1 ring-border">
        {tools.map((tool) => (
          <details key={tool.id} className="group">
            <summary className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-xs">
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">{tool.name}</span>
                {tool.description && (
                  <span className="mt-0.5 block truncate text-muted-foreground">{tool.description}</span>
                )}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {tool.tokens ? `${tool.tokens.toLocaleString()} tok` : '—'}
              </span>
            </summary>
            {tool.raw != null && (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-card/70 px-3 py-2 text-xs leading-snug text-foreground">
                {formatJson(tool.raw)}
              </pre>
            )}
          </details>
        ))}
      </div>
    </section>
  )
}
