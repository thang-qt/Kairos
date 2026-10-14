import { cp, rm, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(
  new URL('../../internal/server/static/', import.meta.url),
)
const destination = fileURLToPath(new URL('../app-dist/', import.meta.url))
await access(`${source}/index.html`)
await rm(destination, { recursive: true, force: true })
await cp(source, destination, { recursive: true })
console.log(`[Kairos] Frontend copied to ${destination}`)
