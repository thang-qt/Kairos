import { KairosIcon } from '@/components/icons/kairos-icon'
import { Button } from '@/components/ui/button'

type ErrorScreenProps = {
  notFound?: boolean
}

export function ErrorScreen({ notFound = false }: ErrorScreenProps) {
  function reloadPage() {
    window.location.reload()
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-6 py-12 text-primary-900">
      <div className="w-full max-w-md text-center">
        <div aria-hidden="true" className="mb-8 flex justify-center">
          <KairosIcon className="size-16" />
        </div>
        {notFound && (
          <p className="mb-3 text-pretty text-xs font-medium text-primary-600">
            Page not found
          </p>
        )}
        <h1 className="text-balance font-serif text-4xl font-medium text-primary-950">
          {notFound ? 'A little off course.' : 'Something went wrong'}
        </h1>
        <p className="mt-4 text-pretty text-sm leading-6 text-primary-700">
          {notFound
            ? 'This page may have moved, or the link may be incorrect. Head back to Kairos to continue.'
            : 'Kairos couldn’t open this page. Try reloading, or head back home to continue.'}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {!notFound && <Button onClick={reloadPage}>Reload page</Button>}
          <Button
            variant={notFound ? 'default' : 'outline'}
            render={<a href="/" />}
          >
            Back to Kairos
          </Button>
        </div>
      </div>
    </main>
  )
}
