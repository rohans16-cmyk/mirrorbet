import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const TALL = 560 // px: taller than this, a section appears at full height with a fade instead of growing

/** A section that opens and shuts like an Apple disclosure: short sections grow to their real height on a quick
 *  spring (~0.2s), tall ones (long lists, charts) appear at full height and fade in, since growing them would re-lay
 *  out the page every frame. Starts moving on the same frame it's opened. The children unmount once it's shut, so
 *  folded sections cost nothing; overflow is clipped only while it moves. */
export function Collapse({
  open,
  children,
  className = '',
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)
  const [settled, setSettled] = useState(open)
  const [tall, setTall] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  // derived during render (React's "adjust state when a prop changes" pattern)
  if (open && !mounted) setMounted(true)
  if (!open && shown) setShown(false)
  if (!open && settled) setSettled(false)
  useLayoutEffect(() => {
    if (!open || shown || !inner.current) return
    // reading the height lays the closed state out, so flipping to open right away still transitions (no frame lost)
    const big = inner.current.scrollHeight > Math.min(TALL, window.innerHeight * 0.7)
    /* eslint-disable react-hooks/set-state-in-effect -- measuring the DOM before paint */
    setTall(big)
    setShown(true)
    if (big) setSettled(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, shown, mounted])
  useEffect(() => {
    if (open) return
    // unmount after the close (tall ones close at once), even without a transitionend (reduced motion, hidden tab)
    const t = window.setTimeout(() => setMounted(false), tall ? 0 : 320)
    return () => window.clearTimeout(t)
  }, [open, tall])
  return (
    <div
      ref={ref}
      className={`collapse-grid ${shown ? 'is-open' : ''} ${settled && shown ? 'is-settled' : ''} ${tall ? 'is-tall' : ''} ${className}`}
      onTransitionEnd={(e) => {
        if (e.target !== ref.current || e.propertyName !== 'grid-template-rows') return
        if (open) setSettled(true)
        else setMounted(false)
      }}
      inert={!open}
    >
      <div className="collapse-clip">
        <div ref={inner} className="collapse-inner">
          {mounted && children}
        </div>
      </div>
    </div>
  )
}
