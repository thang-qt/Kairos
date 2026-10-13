// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelPicker } from './model-picker'
import type { ProviderModel } from '@/lib/app-api'

// jsdom has no layout, so scrolling the highlighted row is a no-op here.
Element.prototype.scrollIntoView = function scrollIntoView() {}

afterEach(cleanup)

function model(id: string, name: string): ProviderModel {
  return {
    id,
    name,
    object: 'model',
    created: 0,
    owned_by: 'openai',
    providerLabel: 'OpenAI',
  }
}

const MODELS = [
  model('gpt-a', 'Alpha'),
  model('gpt-b', 'Beta'),
  model('gpt-c', 'Gamma'),
]

it('filters, moves the highlight and picks a model from the keyboard', async function () {
  const onSelectModel = vi.fn()
  render(
    <ModelPicker
      label="Chat model"
      models={MODELS}
      selectedModelId="gpt-a"
      onSelectModel={onSelectModel}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Chat model' }))
  const search = await screen.findByRole('combobox', { name: 'Search models' })

  fireEvent.keyDown(search, { key: 'ArrowDown' })
  const active = search.getAttribute('aria-activedescendant')
  expect(document.getElementById(active ?? '')?.textContent).toContain('Beta')

  fireEvent.keyDown(search, { key: 'Enter' })
  expect(onSelectModel).toHaveBeenCalledWith('gpt-b')
})

it('starts a new search from its first match', async function () {
  const onSelectModel = vi.fn()
  render(
    <ModelPicker
      label="Chat model"
      models={MODELS}
      selectedModelId="gpt-a"
      onSelectModel={onSelectModel}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Chat model' }))
  const search = await screen.findByRole('combobox', { name: 'Search models' })
  fireEvent.change(search, { target: { value: 'gam' } })
  fireEvent.keyDown(search, { key: 'Enter' })
  expect(onSelectModel).toHaveBeenCalledWith('gpt-c')
})
