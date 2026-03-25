import { spawn } from 'node:child_process'

function startProcess(name, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })

  child.on('exit', function handleExit(code, signal) {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    stopChildren(child.pid)

    if (signal) {
      console.error(`[${name}] exited due to signal ${signal}`)
      process.exitCode = 1
      return
    }

    process.exitCode = code ?? 1
  })

  child.on('error', function handleError(error) {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    stopChildren(child.pid)
    console.error(`[${name}] failed to start:`, error)
    process.exitCode = 1
  })

  children.push(child)
  return child
}

function stopChildren(exitedPid) {
  for (const child of children) {
    if (!child.pid || child.pid === exitedPid || child.killed) {
      continue
    }

    child.kill('SIGTERM')
  }
}

function shutdown(signal) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  stopChildren()

  setTimeout(function forceExit() {
    process.exit(0)
  }, 200).unref()

  if (signal) {
    process.exitCode = 0
  }
}

const children = []
let shuttingDown = false

startProcess('frontend', 'pnpm', ['dev:frontend'])
startProcess('backend', 'pnpm', ['dev:backend'])

process.on('SIGINT', function handleSigint() {
  shutdown('SIGINT')
})

process.on('SIGTERM', function handleSigterm() {
  shutdown('SIGTERM')
})
