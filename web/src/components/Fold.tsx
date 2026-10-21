import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapse } from '@/components/Collapse'

/** Open or folded, remembered in this browser under `key` (a fold stays the way you left it on every trade).
 *  Folded until you open it. */
export function useFold(key: string, start = false): [boolean, (v: boolean) => void] {
  const [open, setRaw] = useState(() => {
    try {
      const v = localStorage.getItem(`fold2.${key}`)
      return v == null ? start : v === '1'
    } catch {
      return start
    }
  })
  const set = (v: boolean) => {
    setRaw(v)
    try {
      localStorage.setItem(`fold2.${key}`, v ? '1' : '0')
    } catch {
      /* private window */
    }
  }
  return [open, set]
}

/** A section that folds: its title always showing (and a one-line summary while folded), the body under it. */
export function Fold({
  id,
  title,
  summary,
  titleClass = 'text-zinc-500',
  className = '',
  headClass = 'px-4 py-3',
  children,
}: {
  id: string
  title: ReactNode
  summary?: ReactNode
  titleClass?: string
  className?: string
  headClass?: string
  children: ReactNode
}) {
  const [open, setOpen] = useFold(id)
  return (
    <div className={className}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`flex w-full items-center gap-3 text-left transition hover:bg-white/[0.02] focus-visible:outline-none ${headClass}`}
      >
        <span className={`shrink-0 text-[0.6875rem] font-semibold uppercase tracking-wider ${titleClass}`}>{title}</span>
        {!open && summary != null && <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{summary}</span>}
        <ChevronDown className={`spring-turn ml-auto size-4 shrink-0 text-zinc-500 ${open ? 'rotate-180' : ''}`} />
      </button>
      <Collapse open={open}>{children}</Collapse>
    </div>
  )
}

/** A page section that folds under a big heading, like "Your position": the heading (and a summary while folded)
 *  always showing, the section under it once opened. Folded until you open it; remembered after. */
export function FoldSection({
  id,
  title,
  summary,
  children,
}: {
  id: string
  title: string
  summary?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useFold(id)
  return (
    <section className="animate-rise">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 border-b border-white/10 pb-3 text-left"
      >
        <h2 className="shrink-0 text-2xl font-semibold text-white">{title}</h2>
        {/* folded: the summary sits on the right, beside the chevron */}
        {!open && summary != null && <span className="ml-auto min-w-0 truncate text-sm text-zinc-400">{summary}</span>}
        <ChevronDown
          className={`spring-turn size-5 shrink-0 text-zinc-500 ${open || summary == null ? 'ml-auto' : ''} ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <Collapse open={open}>
        <div className="pt-4">{children}</div>
      </Collapse>
    </section>
  )
}
