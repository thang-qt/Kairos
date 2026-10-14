// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it } from 'vitest'
import { ChatHeader } from './chat-header'

Element.prototype.scrollIntoView = function scrollIntoView() {}
afterEach(cleanup)

it('opens the controlled header model picker from the composer and respects its disabled state', async function () {
  const client = new QueryClient()
  function header(canSelectModel: boolean) {
    return (
      <QueryClientProvider client={client}>
        <textarea aria-label="Composer" />
        <ChatHeader
          activeTitle="Chat"
          selectedModelId="model"
          models={[
            {
              id: 'model',
              name: 'Model',
              object: 'model',
              created: 0,
              owned_by: 'openai',
            },
          ]}
          canSelectModel={canSelectModel}
          onSelectModel={function select() {}}
        />
      </QueryClientProvider>
    )
  }
  const { rerender } = render(header(false))
  const prompt = screen.getByRole('textbox')
  fireEvent.keyDown(prompt, {
    key: 'M',
    code: 'KeyM',
    ctrlKey: true,
    shiftKey: true,
  })
  expect(screen.queryByRole('combobox', { name: 'Search models' })).toBeNull()
  rerender(header(true))
  expect(
    fireEvent.keyDown(prompt, {
      key: 'M',
      code: 'KeyM',
      ctrlKey: true,
      shiftKey: true,
    }),
  ).toBe(false)
  expect(
    await screen.findByRole('combobox', { name: 'Search models' }),
  ).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search models' }), {
    key: 'Escape',
  })
  client.clear()
})
