import { Suspense, lazy, useState } from 'react'
import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  ArrowRight01Icon,
  Brain01Icon,
  ComputerIcon,
  Copy01Icon,
  Database01Icon,
  FileImportIcon,
  GithubIcon,
  Globe02Icon,
  Image01Icon,
  Key01Icon,
  Moon02Icon,
  PlugSocketIcon,
  SmartPhone01Icon,
  Sun03Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { KairosIconBig } from '@/components/icons/kairos-icon-big'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  SITE_PALETTES,
  setSiteMode,
  setSitePalette,
  useSiteTheme,
} from './site-preferences'
import chatDefault from '../docs/screenshots/chat-default.png'
import chatActivity from '../docs/screenshots/chat-activity.png'
import androidChat from '../docs/screenshots/android-chat.png'
import androidAssistant from '../docs/screenshots/android-assistant.png'

// The demo carries the app's full markdown renderer; load it after the page.
const DemoWindow = lazy(function loadDemo() {
  return import('./demo-window').then(function pick(module) {
    return { default: module.DemoWindow }
  })
})

const REPO_URL = 'https://github.com/thang-qt/Kairos'
const RELEASES_URL = `${REPO_URL}/releases`

export function Landing() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-surface text-primary-950">
      <Atmosphere />
      <SiteHeader />
      <main className="relative">
        <Hero />
        <Features />
        <Platforms />
        <SelfHost />
      </main>
      <SiteFooter />
    </div>
  )
}

function Atmosphere() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60rem]"
        style={{
          background:
            'radial-gradient(ellipse 70% 55% at 50% -5%, var(--theme-atmosphere-glow) 0%, transparent 70%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60rem] opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(var(--theme-atmosphere-grid) 1px, transparent 1px), linear-gradient(90deg, var(--theme-atmosphere-grid) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'linear-gradient(to bottom, black, transparent)',
        }}
      />
    </>
  )
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-primary-200/60 bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2 select-none">
          <KairosIconBig className="size-6" />
          <span className="font-serif text-xl font-medium">Kairos</span>
        </a>
        <nav className="hidden flex-1 items-center gap-6 text-sm text-primary-700 md:flex">
          <a href="#features" className="hover:text-primary-950">
            Features
          </a>
          <a href="#apps" className="hover:text-primary-950">
            Apps
          </a>
          <a href="#self-host" className="hover:text-primary-950">
            Self-host
          </a>
        </nav>
        <div className="ml-auto md:ml-0">
          <Button variant="secondary" size="sm" render={<a href={REPO_URL} />}>
            <HugeiconsIcon icon={GithubIcon} size={20} strokeWidth={1.5} />
            GitHub
          </Button>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section id="top" className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 sm:pt-24">
      <div className="mx-auto max-w-3xl text-center">
        <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50/80 px-3 py-1 text-xs text-primary-700">
          <span className="size-1.5 rounded-full bg-primary-500" />
          Open source · Web, Linux and Android
        </p>
        <h1 className="mt-6 text-balance font-serif text-5xl leading-[1.05] font-medium tracking-tight sm:text-7xl">
          A quiet place to talk with models.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-primary-700">
          Kairos is a focused chat app for hosted LLMs. One Go binary serves the
          web app and its API from a single SQLite file, and the desktop and
          Android apps connect to the server you already run.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" render={<a href="#self-host" />}>
            Run your own server
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={20}
              strokeWidth={1.5}
            />
          </Button>
          <Button
            variant="secondary"
            size="lg"
            render={<a href={RELEASES_URL} />}
          >
            Download for Linux
          </Button>
        </div>
      </div>

      <div className="mx-auto mt-16 max-w-5xl">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-pretty text-sm text-primary-600">
            Not a video. This is Kairos' own message renderer, streaming a
            scripted reply. Open the activity when it finishes.
          </p>
          <ThemeControls />
        </div>
        <Suspense fallback={<DemoPlaceholder />}>
          <DemoWindow />
        </Suspense>
      </div>
    </section>
  )
}

function DemoPlaceholder() {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-2xl border border-primary-200 bg-surface shadow-2xl shadow-primary-950/10"
    >
      <div className="h-12 border-b border-primary-200 bg-primary-50" />
      <div className="h-120 sm:h-136" />
    </div>
  )
}

function ThemeControls() {
  const theme = useSiteTheme()
  return (
    <div className="flex items-center gap-3">
      <div
        role="radiogroup"
        aria-label="Palette"
        className="flex items-center gap-1.5"
      >
        {SITE_PALETTES.map(function renderPalette(palette) {
          const selected = palette === theme.palette
          return (
            <button
              key={palette}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={palette}
              title={palette}
              onClick={function choose() {
                setSitePalette(palette)
              }}
              className={cn(
                `theme-${palette}`,
                theme.mode,
                'theme-scope',
                'relative size-6 overflow-hidden rounded-full border border-primary-950/10 transition-transform hover:scale-110',
                selected
                  ? 'ring-2 ring-primary-950 ring-offset-2 ring-offset-surface'
                  : null,
              )}
            >
              <span className="absolute inset-0 bg-primary-100" />
              <span className="absolute inset-y-0 right-0 w-1/2 bg-primary-500" />
            </button>
          )
        })}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={
          theme.mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
        }
        onClick={function toggleMode() {
          setSiteMode(theme.mode === 'dark' ? 'light' : 'dark')
        }}
      >
        <HugeiconsIcon
          icon={theme.mode === 'dark' ? Sun03Icon : Moon02Icon}
          size={20}
          strokeWidth={1.5}
        />
      </Button>
    </div>
  )
}

type Feature = {
  icon: IconSvgElement
  title: string
  body: string
}

const FEATURES: Array<Feature> = [
  {
    icon: Globe02Icon,
    title: 'Any OpenAI-compatible provider',
    body: 'Chat Completions or the Responses API, OpenRouter included. Models sync with names, context windows and pricing from models.dev.',
  },
  {
    icon: Brain01Icon,
    title: 'Work you can see',
    body: 'Thinking, searches and pages read stream into an activity trail you can open beside any answer.',
  },
  {
    icon: PlugSocketIcon,
    title: 'Remote MCP tools',
    body: 'Connect Streamable HTTP servers such as GitHub. Review a tool call before it runs.',
  },
  {
    icon: FileImportIcon,
    title: 'Bring your history',
    body: 'Import a ChatGPT export. Export any or all conversations as JSON, Markdown or plain text.',
  },
  {
    icon: Image01Icon,
    title: 'Images, stored your way',
    body: 'Attach images from any client. Keep them inline in the database, on disk, or in S3.',
  },
  {
    icon: Key01Icon,
    title: 'Accounts and keys',
    body: 'Sign-in, an admin bootstrap and optional signup. Provider credentials are encrypted at rest.',
  },
]

function Features() {
  return (
    <section
      id="features"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-32 sm:px-6"
    >
      <SectionHeading
        eyebrow="Features"
        title="Built for the conversation, not the dashboard."
        body="No local runtime and no plugin marketplace. Kairos does the few things a daily chat app needs, and keeps out of the way."
      />
      <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-primary-200 bg-primary-200 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(function renderFeature(feature) {
          return (
            <div key={feature.title} className="bg-surface p-6 sm:p-8">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary-100 text-primary-800">
                <HugeiconsIcon
                  icon={feature.icon}
                  size={20}
                  strokeWidth={1.5}
                />
              </span>
              <h3 className="mt-5 text-balance font-medium">{feature.title}</h3>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-primary-700">
                {feature.body}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Platforms() {
  return (
    <section
      id="apps"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-32 sm:px-6"
    >
      <SectionHeading
        eyebrow="Apps"
        title="One server, wherever you are."
        body="Every client talks to the same Kairos server, so a conversation started at your desk continues on your phone."
      />

      <div className="mt-12 grid gap-6 lg:grid-cols-5">
        <PlatformCard
          className="lg:col-span-3"
          icon={ComputerIcon}
          title="Linux desktop"
          body="Lives in the tray and comes forward with Ctrl+Alt+Space. It ships the interface, so it opens instantly and keeps your history readable offline."
          action={
            <a
              href={RELEASES_URL}
              className="text-primary-950 underline decoration-primary-400 underline-offset-4 hover:decoration-primary-950"
            >
              .deb, AppImage or Nix
            </a>
          }
        >
          <img
            src={chatActivity}
            alt="Kairos desktop app showing a research answer with its activity panel"
            className="w-full rounded-xl border border-primary-200 shadow-lg shadow-primary-950/5"
            loading="lazy"
          />
        </PlatformCard>

        <PlatformCard
          className="lg:col-span-2"
          icon={SmartPhone01Icon}
          title="Android"
          body="Streaming chat, image attachments, and an assistant you can summon over any app to ask about what's on screen."
          action={
            <a
              href={`${REPO_URL}/blob/main/android/README.md`}
              className="text-primary-950 underline decoration-primary-400 underline-offset-4 hover:decoration-primary-950"
            >
              Install the APK
            </a>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <img
              src={androidChat}
              alt="Kairos chat on Android"
              className="w-full rounded-2xl border border-primary-200 shadow-lg shadow-primary-950/5"
              loading="lazy"
            />
            <img
              src={androidAssistant}
              alt="Kairos assistant overlay answering a question about another app"
              className="w-full rounded-2xl border border-primary-200 shadow-lg shadow-primary-950/5"
              loading="lazy"
            />
          </div>
        </PlatformCard>

        <PlatformCard
          className="lg:col-span-5"
          icon={Globe02Icon}
          title="Web"
          body="The server's own interface. Install it from the browser as an app, with keyboard shortcuts, a resizable sidebar and six palettes in light and dark."
          horizontal
        >
          <img
            src={chatDefault}
            alt="Kairos web app with a formatted answer and tables"
            className="w-full rounded-xl border border-primary-200 shadow-lg shadow-primary-950/5"
            loading="lazy"
          />
        </PlatformCard>
      </div>
    </section>
  )
}

function PlatformCard({
  className,
  icon,
  title,
  body,
  action,
  horizontal = false,
  children,
}: {
  className?: string
  icon: IconSvgElement
  title: string
  body: string
  action?: ReactNode
  horizontal?: boolean
  children: ReactNode
}) {
  return (
    <article
      className={cn(
        'flex flex-col gap-6 overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 p-6 sm:p-8',
        horizontal ? 'lg:flex-row lg:items-center lg:gap-10' : null,
        className,
      )}
    >
      <div className={cn(horizontal ? 'lg:w-80 lg:shrink-0' : null)}>
        <div className="flex items-center gap-2 text-primary-700">
          <HugeiconsIcon icon={icon} size={20} strokeWidth={1.5} />
          <h3 className="text-balance font-medium text-primary-950">{title}</h3>
        </div>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-primary-700">
          {body}
        </p>
        {action ? <p className="mt-4 text-sm">{action}</p> : null}
      </div>
      <div className="mt-auto min-w-0 flex-1">{children}</div>
    </article>
  )
}

const SOURCE_SNIPPET = `git clone ${REPO_URL}
cd Kairos
pnpm install && pnpm build
go build ./cmd/kairosd
./kairosd`

const NIX_SNIPPET = `# flake.nix
inputs.kairos.url = "github:thang-qt/Kairos";

# configuration.nix
imports = [ inputs.kairos.nixosModules.default ];
services.kairos = {
  enable = true;
  environmentFile = "/run/secrets/kairos.env";
};`

const SNIPPETS = [
  { id: 'source', label: 'From source', code: SOURCE_SNIPPET },
  { id: 'nixos', label: 'NixOS', code: NIX_SNIPPET },
] as const

function SelfHost() {
  const [tab, setTab] = useState<(typeof SNIPPETS)[number]['id']>('source')
  const snippet =
    SNIPPETS.find(function isActive(item) {
      return item.id === tab
    }) ?? SNIPPETS[0]

  return (
    <section
      id="self-host"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-32 sm:px-6"
    >
      <div className="dark theme-scope overflow-hidden rounded-3xl border border-primary-300 bg-primary-50 text-primary-950">
        <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-2 lg:p-14">
          <div>
            <p className="text-sm text-primary-600">Self-host</p>
            <h2 className="mt-3 text-balance font-serif text-4xl font-medium sm:text-5xl">
              One binary. Your keys.
            </h2>
            <p className="mt-4 text-pretty text-primary-700">
              The frontend is embedded in the Go server, which serves the app
              and <code className="font-mono text-sm">/api</code> from one
              origin. Point it at a provider and you're done.
            </p>
            <ul className="mt-8 space-y-4 text-sm text-primary-800">
              <Fact icon={Database01Icon}>
                SQLite by default. There's no database service to run.
              </Fact>
              <Fact icon={Key01Icon}>
                Production mode requires sign-in, secure cookies and a 32+
                character key for stored credentials.
              </Fact>
              <Fact icon={Globe02Icon}>
                Configure providers for everyone in the environment, or let each
                user add their own.
              </Fact>
            </ul>
          </div>

          <div className="min-w-0 overflow-hidden rounded-2xl border border-primary-300 bg-primary-100">
            <div className="flex items-center gap-1 border-b border-primary-300 px-2 py-2">
              {SNIPPETS.map(function renderTab(item) {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={function select() {
                      setTab(item.id)
                    }}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-sm transition-colors',
                      item.id === tab
                        ? 'bg-primary-300 text-primary-950'
                        : 'text-primary-700 hover:text-primary-950',
                    )}
                  >
                    {item.label}
                  </button>
                )
              })}
              <CopyButton text={snippet.code} />
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-primary-900">
              <code>{snippet.code}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  )
}

function Fact({
  icon,
  children,
}: {
  icon: IconSvgElement
  children: ReactNode
}) {
  return (
    <li className="flex gap-3">
      <HugeiconsIcon
        icon={icon}
        size={20}
        strokeWidth={1.5}
        className="mt-px shrink-0 text-primary-600"
      />
      <span className="text-pretty">{children}</span>
    </li>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState<string>()
  const isCopied = copied === text
  return (
    <button
      type="button"
      aria-label="Copy to clipboard"
      onClick={function copy() {
        void navigator.clipboard.writeText(text).then(function done() {
          setCopied(text)
          window.setTimeout(function reset() {
            setCopied(undefined)
          }, 1500)
        })
      }}
      className="ml-auto flex size-8 items-center justify-center rounded-lg text-primary-700 transition-colors hover:bg-primary-200 hover:text-primary-950"
    >
      <HugeiconsIcon
        icon={isCopied ? Tick02Icon : Copy01Icon}
        size={20}
        strokeWidth={1.5}
      />
    </button>
  )
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string
  title: string
  body: string
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm text-primary-600">{eyebrow}</p>
      <h2 className="mt-3 text-balance font-serif text-4xl font-medium sm:text-5xl">
        {title}
      </h2>
      <p className="mt-4 text-pretty text-lg text-primary-700">{body}</p>
    </div>
  )
}

function SiteFooter() {
  return (
    <footer className="mx-auto mt-32 max-w-6xl border-t border-primary-200 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <KairosIconBig className="size-5" />
          <span className="font-serif text-lg font-medium">Kairos</span>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-primary-700">
          <a href={REPO_URL} className="hover:text-primary-950">
            Source
          </a>
          <a href={RELEASES_URL} className="hover:text-primary-950">
            Releases
          </a>
          <a
            href={`${REPO_URL}/tree/main/docs`}
            className="hover:text-primary-950"
          >
            Guides
          </a>
          <a
            href={`${REPO_URL}/blob/main/LICENSE`}
            className="hover:text-primary-950"
          >
            MIT License
          </a>
        </nav>
      </div>
      <p className="mt-6 text-pretty text-xs text-primary-500">
        The original interface was adapted from{' '}
        <a
          href="https://github.com/ibelick/webclaw"
          className="underline underline-offset-2"
        >
          webclaw
        </a>{' '}
        by ibelick.
      </p>
    </footer>
  )
}
