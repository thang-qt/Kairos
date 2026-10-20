import type {
  ConversationTurn,
  MessageContent,
} from '@/lib/chat-backend/contracts'

export type DemoFrame = {
  // How long this frame stays on screen before the next one.
  wait: number
  composer: string
  turns: Array<ConversationTurn>
}

export const DEMO_QUESTION =
  'Should my side project move from Postgres to SQLite?'

const THINKING =
  'One server, a few hundred users, mostly reads. The real tradeoff is operational: one file versus a database service. I should check current guidance on write concurrency before answering.'

const COMMENTARY = 'Let me check the current SQLite guidance.'

const SEARCH_QUERY = 'when to use SQLite vs Postgres single server web app'

const FETCH_URL = 'https://www.sqlite.org/whentouse.html'

const ANSWER = `**Probably yes**, if the app runs on one server and writes are modest.

| | SQLite | Postgres |
|---|---|---|
| Operations | A file next to your binary | A service to run and upgrade |
| Writes | One writer at a time | Many concurrent writers |
| Backups | Copy the file, or stream it | \`pg_dump\` or replicas |

Turn on WAL mode when you open the database, so reads keep flowing during writes:

\`\`\`sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
\`\`\`

Stay on Postgres if several app servers need to write at once.`

const searchStep: ConversationTurn = {
  role: 'toolResult',
  toolCallId: 'demo-search',
  toolName: 'web_search',
  details: {
    webTools: [
      {
        id: 'demo-search',
        name: 'web_search',
        arguments: { query: SEARCH_QUERY },
        durationMs: 1180,
        result: {
          results: [
            {
              title: 'Appropriate Uses For SQLite',
              url: FETCH_URL,
              snippet:
                'SQLite works great as the database engine for most low to medium traffic websites.',
            },
            {
              title: 'Write-Ahead Logging',
              url: 'https://www.sqlite.org/wal.html',
              snippet:
                'Readers do not block writers and a writer does not block readers.',
            },
            {
              title: 'Litestream',
              url: 'https://litestream.io/',
              snippet: 'Streaming replication for SQLite.',
            },
          ],
        },
      },
    ],
  },
}

const fetchStep: ConversationTurn = {
  role: 'toolResult',
  toolCallId: 'demo-fetch',
  toolName: 'web_fetch',
  details: {
    webTools: [
      {
        id: 'demo-fetch',
        name: 'web_fetch',
        arguments: { url: FETCH_URL },
        durationMs: 640,
        result: {
          url: FETCH_URL,
          title: 'Appropriate Uses For SQLite',
          text: 'Generally speaking, any site that gets fewer than 100K hits/day should work fine with SQLite.',
        },
      },
    ],
  },
}

// Splits text into small word groups so the reply streams like a real one.
function chunks(text: string, size: number) {
  const words = text.split(/(?<=\s)/)
  const out: Array<string> = []
  for (let index = 0; index < words.length; index += size) {
    out.push(words.slice(index, index + size).join(''))
  }
  return out
}

export function buildDemoFrames(startedAt: number): Array<DemoFrame> {
  const frames: Array<DemoFrame> = []
  const user: ConversationTurn = {
    id: 'demo-user',
    role: 'user',
    content: [{ type: 'text', text: DEMO_QUESTION }],
    timestamp: startedAt,
  }

  frames.push({ wait: 700, composer: '', turns: [] })
  for (let length = 1; length <= DEMO_QUESTION.length; length += 1) {
    frames.push({
      wait: 34,
      composer: DEMO_QUESTION.slice(0, length),
      turns: [],
    })
  }
  frames.push({ wait: 420, composer: DEMO_QUESTION, turns: [] })

  // Real timestamps keep the activity timer and duration honest.
  const sentAt = startedAt + elapsed(frames)
  let content: Array<MessageContent> = []
  let steps: Array<ConversationTurn> = []

  function assistant(status: string, completedAt?: number): ConversationTurn {
    return {
      id: 'demo-assistant',
      role: 'assistant',
      status,
      model: 'demo-model',
      timestamp: sentAt,
      completedAt,
      content,
      steps,
    }
  }

  function push(wait: number, status = 'running') {
    frames.push({
      wait,
      composer: '',
      turns: [user, assistant(status)],
    })
  }

  push(900)

  let thinking = ''
  for (const piece of chunks(THINKING, 3)) {
    thinking += piece
    content = [{ type: 'thinking', thinking }]
    push(70)
  }
  push(500)

  content = [
    ...content,
    { type: 'text', text: COMMENTARY, phase: 'commentary' },
    {
      type: 'toolCall',
      id: 'demo-search',
      name: 'web_search',
      arguments: { query: SEARCH_QUERY },
    },
  ]
  push(1300)
  steps = [searchStep]
  push(500)

  content = [
    ...content,
    {
      type: 'toolCall',
      id: 'demo-fetch',
      name: 'web_fetch',
      arguments: { url: FETCH_URL },
    },
  ]
  push(900)
  steps = [searchStep, fetchStep]
  push(600)

  const prefix = content
  let answer = ''
  for (const piece of chunks(ANSWER, 2)) {
    answer += piece
    content = [...prefix, { type: 'text', text: answer, phase: 'final_answer' }]
    push(45)
  }

  frames.push({
    wait: 0,
    composer: '',
    turns: [user, assistant('completed', startedAt + elapsed(frames))],
  })
  return frames
}

function elapsed(frames: Array<DemoFrame>) {
  return frames.reduce(function total(sum, frame) {
    return sum + frame.wait
  }, 0)
}
