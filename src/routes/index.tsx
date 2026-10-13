import { createFileRoute, redirect } from '@tanstack/react-router'
import { DesktopWindowBar } from '@/components/desktop-window-bar'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({
      to: '/new',
      replace: true,
    })
  },
  component: IndexRoute,
})

function IndexRoute() {
  return (
    <div className="h-screen flex items-center justify-center text-primary-600">
      <DesktopWindowBar />
      Loading…
    </div>
  )
}
