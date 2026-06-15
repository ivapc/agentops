// Pure, client-safe helpers for the company-scoped Teammate chat URL shape.
// Shared by the runner switch (detection) and the endpoint picker (build/parse).
const TEAMMATE_CHAT_URL = /^(.*)\/api\/companies\/(\d+)\/chat\/?$/

export function isTeammateChatEndpoint(url: string): boolean {
  return TEAMMATE_CHAT_URL.test(url.trim())
}

export function buildTeammateChatUrl(baseUrl: string, companyId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/companies/${companyId}/chat`
}

export function parseTeammateChatUrl(url: string): { baseUrl: string; companyId: string } | null {
  const m = url.trim().match(TEAMMATE_CHAT_URL)
  return m ? { baseUrl: m[1], companyId: m[2] } : null
}
