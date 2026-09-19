import { useCallback, useEffect, useRef } from 'react'
import type { MouseEvent, TouchEvent } from 'react'

// Press-and-hold duration for the touch "open the message menu" gesture —
// deliberately long (the brief asks for ~1.5–2s) so an ordinary tap or a
// scroll flick never triggers it.
export const LONG_PRESS_MS = 1500
// A finger that travels further than this is scrolling, not holding.
const MOVE_TOLERANCE_PX = 10

export interface PressPoint { x: number; y: number }

// One gesture layer for both input types:
//  - Desktop: a right-click (contextmenu event) opens the menu immediately.
//  - Touch: press-and-hold for LONG_PRESS_MS opens the same menu. Android
//    Chrome also fires a native `contextmenu` event ~0.5s into a hold; that
//    one is swallowed (the touch is still in progress) so the menu only ever
//    appears once the full hold has elapsed.
// Returns props to spread onto the element. `enabled=false` makes every
// handler inert and leaves the browser's own context menu alone.
// How long after a completed hold the browser's follow-up click (if it sends
// one at all) is swallowed. Deliberately short: the flag must never outlive
// the finger-lift it exists for, or it eats a later, legitimate tap.
const CLICK_SUPPRESS_MS = 500

export function useLongPress(onOpen: (at: PressPoint) => void, enabled: boolean, ms = LONG_PRESS_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firedReset = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<PressPoint | null>(null)
  const touching = useRef(false)
  const fired = useRef(false)

  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    origin.current = null
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (settle.current) clearTimeout(settle.current)
    if (firedReset.current) clearTimeout(firedReset.current)
  }, [])

  const endTouch = useCallback(() => {
    cancel()
    // A late native contextmenu can arrive just after touchend on some
    // Android builds — keep treating it as part of the touch briefly.
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(() => { touching.current = false }, 500)
    // Expire the click-swallowing flag with the lift that it belongs to.
    if (fired.current) {
      if (firedReset.current) clearTimeout(firedReset.current)
      firedReset.current = setTimeout(() => { fired.current = false }, CLICK_SUPPRESS_MS)
    }
  }, [cancel])

  return {
    onTouchStart: (e: TouchEvent) => {
      // Any new touch starts fresh — even while the gesture is disabled (the
      // inline editor is open), so a stale flag can never eat a Save/Cancel tap.
      fired.current = false
      if (firedReset.current) { clearTimeout(firedReset.current); firedReset.current = null }
      if (!enabled || e.touches.length !== 1) return
      if (settle.current) { clearTimeout(settle.current); settle.current = null }
      touching.current = true
      const t = e.touches[0]
      const at = { x: t.clientX, y: t.clientY }
      origin.current = at
      timer.current = setTimeout(() => {
        timer.current = null
        fired.current = true
        onOpen(at)
      }, ms)
    },
    onTouchMove: (e: TouchEvent) => {
      const start = origin.current
      if (!start || e.touches.length === 0) return
      const t = e.touches[0]
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > MOVE_TOLERANCE_PX) cancel()
    },
    onTouchEnd: (e: TouchEvent) => {
      // After a completed hold, stop the browser from synthesizing mouse /
      // click events that would immediately dismiss the menu we just opened
      // (or follow an attachment link the finger happened to be resting on).
      if (fired.current && e.cancelable) e.preventDefault()
      endTouch()
    },
    onTouchCancel: endTouch,
    onContextMenu: (e: MouseEvent) => {
      if (!enabled) return
      e.preventDefault()
      if (touching.current) return
      onOpen({ x: e.clientX, y: e.clientY })
    },
    onClickCapture: (e: MouseEvent) => {
      if (fired.current) {
        e.preventDefault()
        e.stopPropagation()
        fired.current = false
      }
    },
  }
}
