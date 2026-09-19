import { useEffect, useState } from 'react'

export interface VisualViewportBox { top: number; height: number }

// The part of the screen the user can actually see. A `position: fixed;
// inset: 0` layer is sized to the LAYOUT viewport, which does not shrink when
// a mobile on-screen keyboard opens (iOS Safari, and Android Chrome since it
// switched to "resizes-visual") — so a full-screen chat's composer would end
// up hidden behind the keyboard. Returns null whenever the visual viewport
// matches the layout viewport (the normal case, and any browser without the
// API), so callers can fall back to plain `inset-0` and desktop is untouched.
export function useVisualViewportBox(): VisualViewportBox | null {
  const [box, setBox] = useState<VisualViewportBox | null>(null)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const update = () => {
      const differs = vv.height < window.innerHeight - 1 || vv.offsetTop > 1
      setBox(differs ? { top: vv.offsetTop, height: vv.height } : null)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return box
}
