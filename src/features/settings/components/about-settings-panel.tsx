import { useQuery } from '@tanstack/react-query'
import { KairosIconBig } from '@/components/icons/kairos-icon-big'
import { getDesktopBridge, getShell } from '@/lib/shell'

const repository = 'https://github.com/thang-qt/Kairos'

function AboutLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-sm underline-offset-4 hover:text-primary-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500"
    >
      {children}
    </a>
  )
}

export function AboutSettingsPanel() {
  const isDesktop = getShell().isDesktop
  const getAppInfo = getDesktopBridge()?.getAppInfo
  const appInfo = useQuery({
    queryKey: ['desktop', 'app-info'],
    queryFn: async function readAppInfo() {
      if (!getAppInfo) throw new Error('App information is unavailable')
      return getAppInfo()
    },
    enabled: Boolean(getAppInfo),
    staleTime: Infinity,
  })

  return (
    <section
      aria-labelledby="about-title"
      className="mx-auto flex max-w-sm flex-col items-center px-4 py-12 text-center sm:py-20"
    >
      <div aria-hidden="true">
        <KairosIconBig className="size-20" />
      </div>
      <h1
        id="about-title"
        className="mt-5 text-balance text-2xl font-medium text-primary-950"
      >
        Kairos
      </h1>
      {isDesktop ? (
        <p className="mt-2 text-pretty text-xs tabular-nums text-primary-500">
          {appInfo.data
            ? `Version ${appInfo.data.version}`
            : appInfo.isFetching
              ? 'Loading version…'
              : 'Version unavailable'}
        </p>
      ) : null}
      <p className="mt-5 text-pretty text-sm leading-relaxed text-primary-600">
        Your AI workspace, connected to your own server.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-primary-700">
        <AboutLink href={repository}>Homepage</AboutLink>
        {isDesktop ? (
          <AboutLink href={`${repository}/releases?q=desktop-v&expanded=true`}>
            View updates
          </AboutLink>
        ) : null}
      </div>
      <p className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-pretty text-xs text-primary-500">
        <AboutLink href={`${repository}/blob/main/LICENSE`}>
          MIT License
        </AboutLink>
        <span aria-hidden="true">·</span>
        <AboutLink href="https://github.com/thang-qt">@thang-qt</AboutLink>
      </p>
    </section>
  )
}
