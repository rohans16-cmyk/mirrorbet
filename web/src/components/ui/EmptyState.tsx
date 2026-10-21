import type { ReactNode } from 'react'
import { CloudOff, Inbox } from 'lucide-react'

/** What a page says when it has nothing to show or couldn't load: one plain sentence, a hint, and one thing to do.
 *  Server errors are turned into words (a raw "not_found" or "Cannot reach the server" told you nothing). */
export function EmptyState({
  title,
  hint,
  action,
  error = false,
}: {
  title: ReactNode
  hint?: ReactNode
  action?: { label: string; onClick: () => void }
  error?: boolean
}) {
  const Icon = error ? CloudOff : Inbox
  return (
    <div className="animate-fade flex flex-col items-center gap-2 rounded-2xl bg-white/[0.02] px-6 py-10 text-center ring-1 ring-white/[0.06]">
      <Icon className={`size-6 ${error ? 'text-amber-300/80' : 'text-zinc-500'}`} />
      <p className="text-[0.9375rem] font-medium text-white">{title}</p>
      {hint && <p className="max-w-md text-sm text-zinc-400">{hint}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1 rounded-full bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-violet-500 active:scale-[0.97]"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

/** A server / network error in plain words: (title, hint). */
export function explain(err: string | null | undefined): [string, string] {
  const e = (err || '').trim()
  if (e === 'not_found')
    return ['This part of the page is newer than the server', 'Restart the server (python3 server.py) to load it.']
  if (/cannot reach|failed to fetch|network/i.test(e))
    return ["Can't reach the app's server", 'Is it running? It may be restarting: try again in a few seconds.']
  return ["Couldn't load this", e || 'Something went wrong on the server.']
}

/** The usual "couldn't load" state: explained error + Try again. */
export function LoadError({ err, retry }: { err: string | null | undefined; retry?: () => void }) {
  const [title, hint] = explain(err)
  return (
    <EmptyState error title={title} hint={hint} action={retry ? { label: 'Try again', onClick: retry } : undefined} />
  )
}
