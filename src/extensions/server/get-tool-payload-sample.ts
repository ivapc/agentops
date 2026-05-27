import { createServerFn } from '@tanstack/react-start'
import { fetchToolPayloadSample } from './sources/cosmos-tool-payloads'

export const getToolPayloadSample = createServerFn({ method: 'POST' })
  .inputValidator((input: { toolName: string; threadId: string }) => input)
  .handler(async ({ data }): Promise<string | null> => {
    return fetchToolPayloadSample(data.toolName, data.threadId)
  })
