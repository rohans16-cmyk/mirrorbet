import { useLayoutEffect, useRef, useState } from 'react'

/** The selection pill of an iOS segmented control: one shape that slides (snappy spring) to whichever child of its
 *  parent has data-active="true", instead of each tab painting its own background. Put it first inside a `relative`
 *  container whose tabs are `relative` (so their labels sit above it); `watch` is the selected value. It follows
 *  resizes and wrapping, and doesn't animate on first paint. */
export function SlidePill({ watch, className = 'rounded-full bg-white' }: { watch: unknown; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const measure = () => {
      const el = parent.querySelector<HTMLElement>(':scope > [data-active="true"]')
      setBox(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    parent.querySelectorAll(':scope > *').forEach((c) => ro.observe(c))
    const id = requestAnimationFrame(() => setReady(true))
    return () => {
      ro.disconnect()
      cancelAnimationFrame(id)
    }
  }, [watch])
  return (
    <span
      ref={ref}
      aria-hidden
      className={`slide-pill ${className}`}
      style={{
        translate: box ? `${box.x}px ${box.y}px` : undefined,
        width: box?.w ?? 0,
        height: box?.h ?? 0,
        opacity: box ? 1 : 0,
        transitionDuration: ready ? undefined : '0s',
      }}
    />
  )
}
