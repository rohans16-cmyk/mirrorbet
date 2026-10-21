import { useEffect, useState, type ReactNode } from 'react'
import {
  Check,
  ExternalLink,
  FlaskConical,
  KeyRound,
  Power,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { BotSettings } from '@/components/PolyUS'

type Mode = 'off' | 'ask' | 'auto'
type Us = {
  ok: boolean
  keys: boolean
  cfg: { mode: Mode; stake: number; max_stake: number; max_day: number; min_price?: number; max_price: number }
  copy_people?: { name: string; on?: boolean; min_usd: number }[]
  followed?: { name: string }[]
}

/** The bot's state, read every 10 seconds: what the header's status pill and the guide both show. */
export function useBot() {
  const [us, setUs] = useState<Us | null>(null)
  const [phone, setPhone] = useState(false)
  const load = () => {
    fetch('/api/polymarket/us')
      .then((r) => r.json())
      .then((d: Us) => d.ok && setUs(d))
      .catch(() => {})
    fetch('/api/polymarket/phone')
      .then((r) => r.json())
      .then((d: { on?: boolean }) => setPhone(!!d.on))
      .catch(() => {})
  }
  useEffect(() => {
    load()
    const id = setInterval(load, 10000)
    return () => clearInterval(id)
  }, [])
  const people = [...(us?.copy_people ?? []).map((p) => p.name), ...(us?.followed ?? []).map((p) => p.name)]
  const copying = (us?.copy_people ?? []).filter((p) => p.on !== false)
  const keys = !!us?.keys
  const mode: Mode = us?.cfg.mode ?? 'off'
  const required = [keys, people.length > 0, copying.length > 0, mode !== 'off']
  return {
    us,
    load,
    phone,
    people,
    copying,
    keys,
    mode,
    done: required.filter(Boolean).length,
    total: required.length,
    ready: required.every(Boolean),
  }
}
export type Bot = ReturnType<typeof useBot>

const KEY = 'polybot.intro'
const remembered = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

// ---- header ---------------------------------------------------------------------------------------------------------

/** The logo: a mark that reads as copy (one shape following another). */
export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
      <defs>
        <linearGradient id="pb-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#34d399" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#pb-logo)" />
      <rect x="7" y="7" width="12" height="12" rx="3.5" fill="#0b0b12" opacity="0.35" />
      <rect x="12" y="12" width="13" height="13" rx="3.5" fill="#fff" />
      <path d="M16 18.5l2.2 2.2 4-4.4" stroke="#7c3aed" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Off / Not connected / Asking you / Auto, with a live dot. */
export function StatusPill({ bot }: { bot: Bot }) {
  const [label, tone, live] = !bot.us
    ? ['…', 'bg-zinc-500', false]
    : !bot.keys
      ? ['Not connected', 'bg-amber-400', false]
      : bot.mode === 'auto'
        ? ['Auto', 'bg-emerald-400', true]
        : bot.mode === 'ask'
          ? ['Asking you', 'bg-amber-400', true]
          : ['Bot off', 'bg-zinc-500', false]
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1 text-xs font-semibold text-zinc-300 ring-1 ring-white/10">
      <span className="relative flex size-2">
        {live && <span className={`absolute inline-flex size-full rounded-full ${tone} animate-pb-ping`} />}
        <span className={`relative inline-flex size-2 rounded-full ${tone}`} />
      </span>
      {label}
    </span>
  )
}

/** The way back to the guide, with how far along you are. */
export function GetStartedButton({ bot, open, setOpen }: { bot: Bot; open: boolean; setOpen: (v: boolean) => void }) {
  const r = 7
  const c = 2 * Math.PI * r
  const pct = bot.total ? bot.done / bot.total : 0
  return (
    <button
      onClick={() => setOpen(!open)}
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/[0.04] hover:text-white"
    >
      {bot.ready ? (
        <Check className="size-3.5 text-emerald-300" />
      ) : (
        <svg viewBox="0 0 18 18" className="size-4 -rotate-90">
          <circle cx="9" cy="9" r={r} stroke="rgb(255 255 255 / 0.12)" strokeWidth="2.5" fill="none" />
          <circle
            cx="9"
            cy="9"
            r={r}
            stroke="#a78bfa"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            style={{ transition: 'stroke-dashoffset 0.8s var(--ease-out-apple)' }}
          />
        </svg>
      )}
      {bot.ready ? 'Guide' : `Get started · ${bot.done}/${bot.total}`}
    </button>
  )
}

// ---- the picture: traders → bot → your account ----------------------------------------------------------------------

function Flow({ bot }: { bot: Bot }) {
  const names = (bot.people.length ? bot.people : ['', '', '']).slice(0, 4)
  const ys = names.map((_, i) => 104 + (i - (names.length - 1) / 2) * 46)
  const copying = new Set(bot.copying.map((p) => p.name))
  const live = bot.keys && bot.mode !== 'off'
  const out = 'M262 110 C 300 110, 318 110, 352 110'
  return (
    <svg viewBox="0 0 420 228" className="h-auto w-full max-w-[460px]" role="img" aria-label="Traders you follow, copied by the bot into your account">
      <defs>
        <radialGradient id="pb-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#8b5cf6" stopOpacity="0.55" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pb-node" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a2b38" />
          <stop offset="1" stopColor="#1a1b24" />
        </linearGradient>
        <linearGradient id="pb-bot" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      {/* lines in */}
      {names.map((n, i) => {
        const d = `M76 ${ys[i]} C 130 ${ys[i]}, 140 110, 178 110`
        const on = copying.has(n)
        return (
          <g key={i}>
            <path d={d} stroke={on ? '#8b5cf6' : 'rgb(255 255 255 / 0.12)'} strokeWidth="1.6" fill="none" strokeDasharray="4 8" className="animate-pb-dash" />
            {on && (
              <circle r="3.2" fill="#c4b5fd" className="pb-motion">
                <animateMotion dur="2.6s" repeatCount="indefinite" begin={`${i * 0.55}s`} path={d} />
              </circle>
            )}
          </g>
        )
      })}
      {/* line out */}
      <path d={out} stroke={live ? '#34d399' : 'rgb(255 255 255 / 0.12)'} strokeWidth="1.8" fill="none" strokeDasharray="4 8" className="animate-pb-dash" />
      {live && (
        <circle r="3.6" fill="#6ee7b7" className="pb-motion">
          <animateMotion dur="1.6s" repeatCount="indefinite" path={out} />
        </circle>
      )}
      {/* traders */}
      {names.map((n, i) => (
        <g key={i} transform={`translate(52 ${ys[i]})`}>
          <circle r="21" fill="url(#pb-node)" stroke={copying.has(n) ? '#8b5cf6' : 'rgb(255 255 255 / 0.12)'} strokeWidth="1.5" />
          <text textAnchor="middle" dy="4.5" fontSize="12" fontWeight="700" fill="#e4e4e7">
            {n ? n.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() : '?'}
          </text>
        </g>
      ))}
      {/* the bot */}
      <circle cx="220" cy="110" r="62" fill="url(#pb-core)" className="animate-pb-glow" />
      <g className="animate-pb-float">
        <rect x="182" y="72" width="76" height="76" rx="22" fill="url(#pb-bot)" />
        <rect x="196" y="90" width="22" height="22" rx="6" fill="#0b0b12" opacity="0.35" />
        <rect x="205" y="99" width="26" height="26" rx="7" fill="#fff" />
        <path d="M212 112l4.5 4.5 8-8.8" stroke="#7c3aed" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* your account */}
      <g transform="translate(374 110)">
        <circle r="24" fill="url(#pb-node)" stroke={live ? '#34d399' : 'rgb(255 255 255 / 0.12)'} strokeWidth="1.5" />
        <rect x="-11" y="-8" width="22" height="16" rx="3.5" fill="none" stroke={live ? '#6ee7b7' : '#71717a'} strokeWidth="2" />
        <line x1="-11" y1="-2" x2="11" y2="-2" stroke={live ? '#6ee7b7' : '#71717a'} strokeWidth="2" />
      </g>
      <text x="52" y="222" textAnchor="middle" fontSize="10.5" fill="#71717a">Traders you follow</text>
      <text x="220" y="176" textAnchor="middle" fontSize="10.5" fill="#a1a1aa" fontWeight="600">PolyShadow</text>
      <text x="374" y="152" textAnchor="middle" fontSize="10.5" fill="#71717a">Your account</text>
    </svg>
  )
}

// ---- the guide ------------------------------------------------------------------------------------------------------

type Step = { icon: LucideIcon; done: boolean; optional?: boolean; title: string; body: ReactNode; action?: (main: boolean) => ReactNode }

/** What to do to get the bot running (asked 2026-10-19: "an introduction where it explains what you have to do",
 *  then "add graphics and animations ... like a full production product"). Each step ticks itself off from the bot's
 *  own state; its button opens the place to do it. */
export function GetStarted({ bot, open, setOpen }: { bot: Bot; open: boolean; setOpen: (v: boolean) => void }) {
  const [settings, setSettings] = useState(false)
  const { us } = bot

  // open by itself until the bot is set up, unless you hid it
  useEffect(() => {
    if (us && !bot.ready && remembered() !== 'closed') setOpen(true)
  }, [us, bot.ready]) // eslint-disable-line react-hooks/exhaustive-deps
  const hide = () => {
    setOpen(false)
    try {
      localStorage.setItem(KEY, 'closed')
    } catch {
      /* private window */
    }
  }

  const btn =
    'inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-zinc-100 ring-1 ring-white/10 transition hover:bg-white/[0.12] active:scale-[0.97]'
  const primary =
    'inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-violet-900/40 transition hover:bg-violet-500 active:scale-[0.97]'
  const openSettings = (main: boolean) => (
    <button onClick={() => setSettings(true)} className={main ? primary : btn}>
      <Settings2 className="size-3.5" /> Open Bot settings
    </button>
  )
  const money = (x: number) => `$${x % 1 ? x.toFixed(2) : x}`
  const steps: Step[] = [
    {
      icon: KeyRound,
      done: bot.keys,
      title: 'Connect your Polymarket US account',
      body: (
        <>
          On <b className="text-zinc-200">polymarket.us/developer</b>, create an API key and copy its <b className="text-zinc-200">Key ID</b> and{' '}
          <b className="text-zinc-200">Secret</b> (the secret shows only once). Paste both into Bot settings. They stay on this computer.
        </>
      ),
      action: (main: boolean) => (
        <span className="flex flex-wrap gap-2">
          <a href="https://polymarket.us/developer" target="_blank" rel="noreferrer" className={btn}>
            <ExternalLink className="size-3.5" /> Get a key
          </a>
          {openSettings(main)}
        </span>
      ),
    },
    {
      icon: Users,
      done: bot.people.length > 0,
      title: 'Follow traders',
      body: (
        <>
          {bot.people.length ? `You're following ${bot.people.join(', ')}.` : 'Nobody yet.'} To add someone, paste their{' '}
          <b className="text-zinc-200">polymarket.com/@name</b> link in the box above <b className="text-zinc-200">People</b> and press Follow. Their{' '}
          <b className="text-zinc-200">Record</b> tab shows what copying them would have made.
        </>
      ),
    },
    {
      icon: UserCheck,
      done: bot.copying.length > 0,
      title: 'Choose who the bot copies',
      body: (
        <>
          Bot settings → People it copies: each person, and the smallest bet of theirs worth copying.{' '}
          {bot.copying.length
            ? `Copying ${bot.copying.map((p) => `${p.name} (${money(p.min_usd / 1000)}K+)`).join(', ')}.`
            : ''}
        </>
      ),
      action: openSettings,
    },
    {
      icon: SlidersHorizontal,
      done: false,
      optional: true,
      title: 'Set your limits',
      body: (
        <>
          <b className="text-zinc-200">Bet at their usual size</b> is what you bet when they bet their typical amount; bigger bets of theirs get
          more. Then the most per bet, per day, and the price range.
          {us &&
            ` Now: ${money(us.cfg.stake)} usual · ${money(us.cfg.max_stake)} max a bet · ${money(us.cfg.max_day)} a day · ${Math.round((us.cfg.min_price ?? 0) * 100)}–${Math.round(us.cfg.max_price * 100)}¢.`}
        </>
      ),
      action: openSettings,
    },
    {
      icon: Power,
      done: bot.mode !== 'off',
      title: 'Turn it on',
      body: (
        <>
          Bot settings → Copying. <b className="text-zinc-200">Ask me</b>: each copy waits for your tap. <b className="text-zinc-200">Auto</b>: it buys
          and sells on its own, while this app is running. It sells when they sell.
        </>
      ),
      action: openSettings,
    },
    {
      icon: Smartphone,
      done: bot.phone,
      optional: true,
      title: 'Phone alerts',
      body: <>Their big bets pushed to your phone, through your own Telegram bot or the free ntfy app.</>,
      action: openSettings,
    },
    {
      icon: FlaskConical,
      done: false,
      optional: true,
      title: 'Practice first',
      body: (
        <>
          <b className="text-zinc-200">Paper money</b> copies each person with fake money, graded on real results, so you can see how a setup does
          before risking anything.
        </>
      ),
    },
  ]
  // the first required step not done is "next"
  const next = steps.findIndex((s) => !s.done && !s.optional)
  const pct = bot.total ? bot.done / bot.total : 0

  return (
    <>
      {open && (
        <section className="animate-rise relative mb-8 overflow-hidden rounded-[28px] bg-surface-1 ring-1 ring-white/10">
          {/* soft color behind the hero */}
          <div className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-violet-600/20 blur-3xl" />
          <div className="pointer-events-none absolute -right-20 top-10 size-72 rounded-full bg-emerald-500/10 blur-3xl" />

          <div className="relative grid items-center gap-6 p-6 md:grid-cols-[1.1fr_1fr] md:p-8">
            <div className="space-y-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-violet-200 ring-1 ring-violet-400/20">
                {bot.ready ? 'Ready' : 'Setup'}
              </span>
              <h2 className="text-2xl font-semibold leading-tight text-white md:text-3xl">
                {bot.ready ? (
                  <span className="inline-flex items-center gap-3">
                    You're all set
                    <span className="animate-stamp grid size-8 place-items-center rounded-full bg-emerald-500/20 text-emerald-300">
                      <Check className="size-5" />
                    </span>
                  </span>
                ) : (
                  <>Copy the traders you trust, automatically.</>
                )}
              </h2>
              <p className="max-w-md text-sm leading-relaxed text-zinc-400">
                {bot.ready
                  ? `The bot is ${bot.mode === 'auto' ? 'copying on its own' : 'asking you before each copy'}. Everything below can be changed any time.`
                  : 'PolyShadow watches the Polymarket traders you follow and copies their bigger bets onto your Polymarket US account, with your limits. Nothing is spent until you turn it on.'}
              </p>
              <div className="max-w-sm space-y-1.5">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>
                    {bot.done} of {bot.total} steps
                  </span>
                  <span>{Math.round(pct * 100)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    key={bot.done}
                    className="animate-pb-fill h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-400"
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-center md:justify-end">
              <Flow bot={bot} />
            </div>
          </div>

          <ol className="relative grid gap-3 border-t border-white/[0.06] p-4 sm:grid-cols-2 md:p-6">
            {steps.map((s, i) => {
              const Icon = s.icon
              const isNext = i === next
              return (
                <li
                  key={s.title}
                  style={{ animationDelay: `${80 + i * 55}ms` }}
                  className={`animate-rise relative flex gap-3.5 rounded-2xl p-4 transition ${
                    isNext
                      ? 'bg-violet-500/[0.07] ring-1 ring-violet-400/40'
                      : s.done
                        ? 'bg-white/[0.015] ring-1 ring-white/[0.05]'
                        : 'bg-white/[0.025] ring-1 ring-white/[0.07]'
                  }`}
                >
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                      s.done
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : isNext
                          ? 'animate-pb-ring bg-violet-500/20 text-violet-200'
                          : 'bg-white/[0.05] text-zinc-400'
                    }`}
                  >
                    {s.done ? <Check key="done" className="animate-stamp size-5" /> : <Icon className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-semibold ${s.done ? 'text-zinc-400' : 'text-white'}`}>{s.title}</span>
                      {isNext && (
                        <span className="rounded-full bg-violet-500/20 px-2 py-px text-[10px] font-semibold uppercase tracking-wider text-violet-200">
                          Next
                        </span>
                      )}
                      {s.optional && !s.done && (
                        <span className="rounded-full bg-white/[0.05] px-2 py-px text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          {s.title === 'Set your limits' ? 'Check' : 'Optional'}
                        </span>
                      )}
                    </div>
                    <p className={`text-[13px] leading-relaxed ${s.done ? 'text-zinc-500' : 'text-zinc-400'}`}>{s.body}</p>
                    {s.action && !s.done && <div className="pt-1">{s.action(isNext)}</div>}
                  </div>
                </li>
              )
            })}
          </ol>

          <div className="relative flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-6 py-4">
            <p className="text-xs text-zinc-500">Past results don't promise future ones. Start small, with money you're fine losing.</p>
            <button onClick={hide} className="rounded-full px-3 py-1 text-xs font-semibold text-zinc-400 ring-1 ring-white/10 transition hover:text-white">
              Hide guide
            </button>
          </div>
        </section>
      )}
      <BotSettings open={settings} onOpenChange={setSettings} onChange={bot.load} />
    </>
  )
}
