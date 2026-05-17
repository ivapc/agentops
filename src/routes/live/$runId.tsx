import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/live/$runId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/runs/$runId',
      params: { runId: params.runId },
    })
  },
})
