import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/connect')({
  beforeLoad: function redirectLegacyConnectRoute() {
    throw redirect({
      to: '/new',
      replace: true,
    })
  },
  component: ConnectRoute,
})

function ConnectRoute() {
  return null
}
