// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { useSidebarActions } from './use-sidebar-actions'
import { SessionRenameDialog } from '../components/sidebar/session-rename-dialog'
import { SessionDeleteDialog } from '../components/sidebar/session-delete-dialog'

const { remove, rename } = vi.hoisted(function mocks() {
  return { remove: vi.fn(), rename: vi.fn() }
})
vi.mock('@tanstack/react-router', function router() {
  return {
    useNavigate: function useNavigate() {
      return function navigate() {}
    },
  }
})
vi.mock('./use-delete-session', function mutation() {
  return {
    useDeleteSession: function useDeleteSession() {
      return { deleteSession: remove }
    },
  }
})
vi.mock('./use-rename-session', function mutation() {
  return {
    useRenameSession: function useRenameSession() {
      return { renameSession: rename }
    },
  }
})
afterEach(function reset() {
  cleanup()
  vi.clearAllMocks()
})

function SidebarActions({ activeId = 'chat' }: { activeId?: string }) {
  const actions = useSidebarActions({
    sessions: [{ key: 'session', friendlyId: 'chat', label: 'Active chat' }],
    activeFriendlyId: activeId,
    onCreateSession: function create() {},
  })
  return (
    <div inert>
      <SessionRenameDialog
        open={actions.renameDialogOpen}
        onOpenChange={actions.setRenameDialogOpen}
        sessionTitle={actions.renameSessionTitle}
        onSave={actions.handleSaveRename}
        onCancel={function cancel() {
          actions.setRenameDialogOpen(false)
        }}
      />
      <SessionDeleteDialog
        open={actions.deleteDialogOpen}
        onOpenChange={actions.setDeleteDialogOpen}
        sessionTitle={actions.deleteSessionTitle}
        onConfirm={actions.handleConfirmDelete}
        onCancel={function cancel() {
          actions.setDeleteDialogOpen(false)
        }}
      />
    </div>
  )
}
function setup(activeId?: string) {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <textarea aria-label="Composer" />
      <SidebarActions activeId={activeId} />
    </QueryClientProvider>,
  )
  return client
}

it('opens rename for the active chat even when its sidebar is collapsed', async function () {
  const client = setup()
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'F2' })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.keyDown(document.body, { key: 'F2' })
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(screen.getByDisplayValue('Active chat')).toBeTruthy()
  expect(rename).not.toHaveBeenCalled()
  client.clear()
})

it('delete shortcut opens confirmation and deletes only after confirmation', async function () {
  const client = setup()
  fireEvent.keyDown(screen.getByRole('textbox'), {
    key: 'Backspace',
    ctrlKey: true,
    shiftKey: true,
  })
  expect(await screen.findByRole('alertdialog')).toBeTruthy()
  expect(remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(remove).toHaveBeenCalledWith('session', 'chat', true)
  client.clear()
})

it('ignores rename/delete when there is no saved active session', function () {
  const client = setup('new')
  fireEvent.keyDown(document.body, { key: 'F2' })
  fireEvent.keyDown(document.body, {
    key: 'Backspace',
    ctrlKey: true,
    shiftKey: true,
  })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(remove).not.toHaveBeenCalled()
  client.clear()
})
