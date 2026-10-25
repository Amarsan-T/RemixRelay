import { useEffect, useRef } from 'react'

/** Sent when a revealed element ends up under a floating panel, so the panel can step aside. */
export const UNCOVER_EVENT = 'remixrelay:uncover'

/**
 * Scrolls its parent element into the middle of every scrolling area around
 * it (and the page) whenever `token` changes. Waits two frames so editors that
 * resize their grid on first show have finished laying out. If a floating
 * panel (marked `data-floating-panel`) still covers it, asks that panel to get
 * out of the way.
 */
export function Reveal({ token }: { token: number | string }) {
  const marker = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let inner = 0
    let settle: ReturnType<typeof setTimeout> | undefined
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const target = marker.current?.parentElement
        if (!target) return
        const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: smooth ? 'smooth' : 'auto' })
        settle = setTimeout(() => {
          const box = target.getBoundingClientRect()
          const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
          if (top?.closest('[data-floating-panel]')) window.dispatchEvent(new Event(UNCOVER_EVENT))
        }, smooth ? 500 : 0)
      })
    })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); clearTimeout(settle) }
  }, [token])
  return <span ref={marker} aria-hidden="true" className="hidden" />
}
