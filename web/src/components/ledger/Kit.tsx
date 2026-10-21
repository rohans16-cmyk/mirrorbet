import { useFold } from '@/components/Fold'
import { useState } from 'react'
import { SlidePill } from '@/components/ui/SlidePill'
import { ChevronDown } from 'lucide-react'

/** The shared look for the money pages (Bankroll and Record) in both Sports and Stocks: the same header, stat tiles,
 *  "read" panel, section cards and tab bar, so the two products feel like one app with different content. */

export const PANEL = 'rounded-2xl border border-white/10 bg-surface-1'

export function PageHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        {sub && <p className="text-sm text-zinc-400">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export type TileT = {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'good' | 'bad' | 'warn'
  /** 0..1: a thin bar under the value (how much of a limit is used) */
  meter?: number
}

export function Tile({ label, value, sub, tone, meter }: TileT) {
  const color =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'bad'
        ? 'text-red-300'
        : tone === 'warn'
          ? 'text-amber-200'
          : 'text-white'
  const bar =
    meter == null
      ? null
      : meter > 0.8
        ? 'bg-red-400'
        : meter > 0.5
          ? 'bg-amber-400'
          : tone === 'bad'
            ? 'bg-red-400'
            : 'bg-sky-400'
  return (
    <div className={`${PANEL} animate-rise px-4 py-3`}>
      <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {meter != null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`h-full rounded-full transition-all duration-700 ${bar}`}
            style={{ width: `${Math.max(0, Math.min(1, meter)) * 100}%` }}
          />
        </div>
      )}
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  )
}

/** A row of stat tiles: 2 across on phones, all across on wide screens. */
export function Tiles({ tiles }: { tiles: TileT[] }) {
  const cols =
    tiles.length >= 5
      ? 'lg:grid-cols-5'
      : tiles.length === 4
        ? 'lg:grid-cols-4'
        : tiles.length === 3
          ? 'sm:grid-cols-3'
          : ''
  return (
    <div className={`grid grid-cols-2 gap-3 ${cols}`}>
      {tiles.map((t) => (
        <Tile key={t.label} {...t} />
      ))}
    </div>
  )
}

const GRADE: Record<string, string> = {
  Excellent: 'from-emerald-500/25 text-emerald-200 ring-emerald-400/40',
  Strong: 'from-emerald-500/20 text-emerald-200 ring-emerald-400/35',
  Steady: 'from-sky-500/15 text-sky-200 ring-sky-400/30',
  Slipping: 'from-amber-500/15 text-amber-200 ring-amber-400/30',
  'Rough patch': 'from-red-500/20 text-red-200 ring-red-400/40',
  Struggling: 'from-red-500/20 text-red-200 ring-red-400/40',
  'Too early': 'from-white/[0.06] text-zinc-300 ring-white/10',
  'Getting started': 'from-white/[0.06] text-zinc-300 ring-white/10',
}
export type Finding = string | { text: string; tone?: string }

/** "The read": a grade and one line, then what's working and what to watch (click to open). */
export function ReadPanel({
  grade,
  headline,
  good,
  watch,
  foot,
  startOpen = true,
  storeKey,
}: {
  grade: string
  headline: React.ReactNode
  good: Finding[]
  watch: Finding[]
  foot?: React.ReactNode
  startOpen?: boolean
  /** remember open / closed in this browser under this key */
  storeKey?: string
}) {
  const [open, setOpenRaw] = useState(() => {
    try {
      const v = storeKey ? localStorage.getItem(storeKey) : null
      return v == null ? startOpen : v === '1'
    } catch {
      return startOpen
    }
  })
  const setOpen = (v: boolean) => {
    setOpenRaw(v)
    try {
      if (storeKey) localStorage.setItem(storeKey, v ? '1' : '0')
    } catch {
      /* private window */
    }
  }
  const any = good.length + watch.length > 0
  return (
    <section className={`${PANEL} animate-rise overflow-hidden`}>
      <button
        onClick={() => any && setOpen(!open)}
        aria-expanded={open}
        className={`flex w-full flex-col gap-2 p-4 text-left sm:flex-row sm:items-start ${any ? 'transition-colors hover:bg-white/[0.02]' : 'cursor-default'}`}
      >
        <span
          className={`shrink-0 rounded-xl bg-gradient-to-br to-transparent px-3 py-1.5 text-sm font-bold ring-1 ${GRADE[grade] ?? GRADE['Too early']}`}
        >
          {grade}
        </span>
        <p className="min-w-0 flex-1 text-[0.9375rem] leading-relaxed text-zinc-100">
          {open && any ? <span className="text-zinc-400">What’s working and what to watch</span> : headline}
        </p>
        {any && <ChevronDown className={`size-4 shrink-0 text-zinc-500 spring-turn ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && any && (
        <div className="animate-fade border-t border-white/[0.06] p-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <Findings title="What’s working" good items={good} empty="Nothing stands out yet." />
            <Findings title="Watch" items={watch} empty="Nothing to worry about." />
          </div>
          {foot && <p className="mt-3 text-[0.6875rem] text-zinc-500">{foot}</p>}
        </div>
      )}
    </section>
  )
}

function Findings({ title, good, items, empty }: { title: string; good?: boolean; items: Finding[]; empty: string }) {
  return (
    <div
      className={`rounded-xl border p-4 ${good ? 'border-emerald-400/20 bg-emerald-500/[0.05]' : 'border-amber-400/20 bg-amber-500/[0.04]'}`}
    >
      <div
        className={`mb-3 text-xs font-semibold uppercase tracking-wide ${good ? 'text-emerald-300' : 'text-amber-300'}`}
      >
        {title}
      </div>
      {items.length ? (
        <ul className="space-y-2.5">
          {items.map((x, i) => {
            const text = typeof x === 'string' ? x : x.text
            const neutral = typeof x !== 'string' && x.tone === 'neutral'
            const cut = text.indexOf(': ')
            const lead = cut > 0 && cut < 48 ? text.slice(0, cut) : null
            return (
              <li key={text} className="animate-rise flex gap-3" style={{ animationDelay: `${i * 40}ms` }}>
                <span
                  className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                    good
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : neutral
                        ? 'bg-white/[0.06] text-zinc-400'
                        : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {good ? '✓' : neutral ? 'i' : '!'}
                </span>
                <span className={`text-sm leading-relaxed ${neutral ? 'text-zinc-400' : 'text-zinc-200'}`}>
                  {lead && <b className="font-semibold text-white">{lead}: </b>}
                  {lead ? text.slice(cut + 2) : text}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">{empty}</p>
      )}
    </div>
  )
}

/** A card with a small uppercase title (and optional controls on the right). */
export function Section({
  title,
  right,
  children,
  pad = true,
  fold,
  summary,
}: {
  title?: string
  right?: React.ReactNode
  children: React.ReactNode
  pad?: boolean
  fold?: string // an id: the title folds the section (open to start, remembered in this browser)
  summary?: React.ReactNode // shown on the title line while folded
}) {
  if (fold) return <FoldSection id={fold} title={title} right={right} pad={pad} summary={summary}>{children}</FoldSection>
  return (
    <section className={`${PANEL} animate-rise ${pad ? 'p-4' : 'overflow-hidden'}`}>
      {(title || right) && (
        <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 ${pad ? '' : 'px-4 pt-4'}`}>
          {title && <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

function FoldSection({
  id,
  title,
  right,
  pad,
  summary,
  children,
}: {
  id: string
  title?: string
  right?: React.ReactNode
  pad: boolean
  summary?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useFold(id, true)
  return (
    <section className={`${PANEL} animate-rise ${pad ? 'p-4' : 'overflow-hidden'}`}>
      <div className={`flex flex-wrap items-center justify-between gap-2 ${open ? 'mb-3' : ''} ${pad ? '' : 'px-4 pt-4'} ${!open && !pad ? 'pb-4' : ''}`}>
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
        >
          <ChevronDown className={`size-4 shrink-0 text-zinc-500 transition ${open ? '' : '-rotate-90'}`} />
          {title && <h3 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>}
          {!open && summary != null && <span className="min-w-0 truncate text-sm text-zinc-400">{summary}</span>}
        </button>
        {open && right}
      </div>
      {open && children}
    </section>
  )
}

/** The tab bar at the top of a page with several views. */
export function TabBar<T extends string>({
  value,
  tabs,
  onChange,
}: {
  value: T
  tabs: readonly (readonly [T, string])[]
  onChange: (v: T) => void
}) {
  return (
    <div className="relative inline-flex rounded-full bg-white/[0.04] p-1 ring-1 ring-white/[0.06]">
      <SlidePill watch={value} />
      {tabs.map(([k, label]) => (
        <button
          key={k}
          data-active={value === k}
          onClick={() => onChange(k)}
          className={`relative rounded-full px-5 py-1.5 text-[0.9375rem] font-medium transition-colors ${value === k ? 'text-black' : 'text-zinc-400 hover:text-white'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Small filter chips (All / Calls / Puts, Hits / Misses...). */
export function Chips<T extends string>({
  value,
  chips,
  onChange,
}: {
  value: T
  chips: readonly (readonly [T, string])[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(([k, t]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${value === k ? 'bg-white text-black ring-white' : 'text-zinc-400 ring-white/10 hover:text-white'}`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}
