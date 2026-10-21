import { useEffect, useRef, useState } from 'react'

/** In-app replacements for the browser's alert / confirm / prompt (those grey system boxes don't match the app):
 *  `await ask.confirm('Delete?')`, `await ask.prompt('New bankroll', '500')`, `await ask.notice('Saved')`.
 *  One <AskHost /> (mounted in main.tsx) shows them as a sheet over a dimmed backdrop. */
type Req = {
  kind: 'confirm' | 'prompt' | 'notice'
  text: string
  value?: string
  ok?: string
  danger?: boolean
  done: (v: boolean | string | null) => void
}
// requests wait here in order; the host shows the first and moves on when it's answered
const queue: Req[] = []
let wake: (() => void) | null = null
const open = (r: Omit<Req, 'done'>) =>
  new Promise<boolean | string | null>((done) => {
    queue.push({ ...r, done })
    wake?.()
  })

export const ask = {
  confirm: (text: string, o: { ok?: string; danger?: boolean } = {}) =>
    open({ kind: 'confirm', text, ...o }) as Promise<boolean>,
  prompt: (text: string, value = '', o: { ok?: string } = {}) =>
    open({ kind: 'prompt', text, value, ...o }) as Promise<string | null>,
  notice: (text: string) => open({ kind: 'notice', text }).then(() => undefined),
}

export function AskHost() {
  const [cur, setCur] = useState<Req | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const okBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    wake = () => setCur((c) => c ?? queue[0] ?? null)
    wake()
    return () => {
      wake = null
    }
  }, [])
  useEffect(() => {
    if (!cur) return
    const id = window.setTimeout(() => (cur.kind === 'prompt' ? input.current?.select() : okBtn.current?.focus()), 30)
    return () => window.clearTimeout(id)
  }, [cur])
  if (!cur) return null
  const finish = (v: boolean | string | null) => {
    queue.shift()
    cur.done(v)
    setCur(queue[0] ?? null)
  }
  const cancel = () => finish(cur.kind === 'prompt' ? null : false)
  const accept = () => finish(cur.kind === 'prompt' ? (input.current?.value ?? '') : true)
  return (
    <div
      data-ask-host
      style={{ pointerEvents: 'auto' }}
      className="animate-backdrop fixed inset-0 z-[200] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && cancel()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel()
        if (e.key === 'Enter') accept()
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="animate-sheet w-full max-w-sm rounded-2xl border border-white/10 bg-surface-1 p-5 shadow-2xl shadow-black/70">
        <p className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-zinc-100">{cur.text}</p>
        {cur.kind === 'prompt' && (
          <input
            key={queue.length + cur.text}
            ref={input}
            defaultValue={cur.value ?? ''}
            className="mt-3 h-10 w-full rounded-xl bg-black/30 px-3 text-sm text-white ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-sky-400/60"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          {cur.kind !== 'notice' && (
            <button
              onClick={cancel}
              className="rounded-full bg-white/[0.06] px-4 py-2 text-sm font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
            >
              Cancel
            </button>
          )}
          <button
            ref={okBtn}
            onClick={accept}
            className={`rounded-full px-4 py-2 text-sm font-bold ${cur.danger ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-white text-black hover:bg-zinc-200'}`}
          >
            {cur.ok ?? (cur.kind === 'confirm' ? 'OK' : cur.kind === 'prompt' ? 'Save' : 'Got it')}
          </button>
        </div>
      </div>
    </div>
  )
}
