import { post } from './store'

function horizontalAncestor(target: EventTarget | null): HTMLElement | null {
  let element = target instanceof Element ? target : null
  while (element && element !== document.body) {
    if (
      element instanceof HTMLElement &&
      element.scrollWidth > element.clientWidth + 2 &&
      /auto|scroll/.test(getComputedStyle(element).overflowX)
    )
      return element
    element = element.parentElement
  }
  return null
}

export function installInteractions() {
  let timer: number | undefined
  let startX = 0
  let startY = 0
  let scroller: HTMLElement | null = null
  let horizontal = false
  let selected = false
  let reportedDirection = false
  function clearPress() {
    window.clearTimeout(timer)
    timer = undefined
  }
  function reportHorizontal(active: boolean, phase: 'start' | 'move' | 'end') {
    horizontal = active
    post({ type: 'hscroll', active, phase })
  }
  document.addEventListener(
    'touchstart',
    function start(event) {
      clearPress()
      if (event.touches.length !== 1) {
        reportHorizontal(false, 'end')
        return
      }
      const touch = event.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      scroller = horizontalAncestor(event.target)
      selected = Boolean(window.getSelection()?.toString())
      // Reserve a scrollable region until the direction is known. Report false for every other DOWN too.
      reportedDirection = false
      reportHorizontal(Boolean(scroller), 'start')
      const element = event.target instanceof Element ? event.target : null
      const id =
        element?.closest<HTMLElement>('[data-message-id]')?.dataset.messageId
      if (id && !element?.closest('a,button,input') && !selected) {
        timer = window.setTimeout(function longPress() {
          if (!window.getSelection()?.toString())
            post({ type: 'longPress', id })
        }, 500)
      }
    },
    { passive: true },
  )
  document.addEventListener(
    'touchmove',
    function move(event) {
      if (event.touches.length !== 1) {
        clearPress()
        return
      }
      const dx = event.touches[0].clientX - startX
      const dy = event.touches[0].clientY - startY
      if (Math.hypot(dx, dy) > 10) clearPress()
      if (Math.abs(dx) < 6 || Math.abs(dx) <= Math.abs(dy)) return
      const active = Boolean(
        scroller &&
        (dx > 0
          ? scroller.scrollLeft > 1
          : scroller.scrollLeft + scroller.clientWidth <
            scroller.scrollWidth - 1),
      )
      if (!reportedDirection || active !== horizontal)
        reportHorizontal(active, 'move')
      reportedDirection = true
    },
    { passive: true },
  )
  function end() {
    clearPress()
    scroller = null
    reportHorizontal(false, 'end')
  }
  document.addEventListener('touchend', end, { passive: true })
  document.addEventListener('touchcancel', end, { passive: true })
  document.addEventListener('selectionchange', function selection() {
    if (window.getSelection()?.toString()) {
      selected = true
      clearPress()
    }
  })
  document.addEventListener('click', function link(event) {
    const element = event.target instanceof Element ? event.target : null
    const anchor = element?.closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    event.preventDefault()
    post({ type: 'link', href: anchor.href })
  })
}
