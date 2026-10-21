import { useEffect, useState } from 'react'
import { PolyProfiles } from '@/components/PolyProfiles'
import { GetStarted, GetStartedButton, Logo, StatusPill, useBot } from './GetStarted'

/** Alerts from the server (a followed trader's bet, a copy the bot placed or sold) as browser notifications. */
function useAlerts() {
  useEffect(() => {
    let since = new Date().toISOString().slice(0, 19)
    const ask = () => {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
      window.removeEventListener('click', ask)
    }
    window.addEventListener('click', ask)
    const poll = () =>
      fetch(`/api/alerts?since=${encodeURIComponent(since)}`)
        .then((r) => r.json())
        .then((d: { alerts?: { at: string; title: string; text: string }[] }) => {
          for (const a of d.alerts ?? []) {
            since = a.at > since ? a.at : since
            if ('Notification' in window && Notification.permission === 'granted')
              new Notification(a.title, { body: a.text, icon: '/favicon.svg' })
          }
        })
        .catch(() => {})
    const id = setInterval(poll, 15000)
    return () => {
      clearInterval(id)
      window.removeEventListener('click', ask)
    }
  }, [])
}

export default function App() {
  useAlerts()
  const [intro, setIntro] = useState(false)
  const bot = useBot()
  return (
    <div className="min-h-svh bg-surface-0 text-white">
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-surface-0/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
          <Logo />
          <span className="text-base font-semibold tracking-tight">Polybot</span>
          <span className="hidden text-xs text-zinc-500 sm:inline">copy the Polymarket traders you follow</span>
          <span className="ml-auto flex items-center gap-2">
            <StatusPill bot={bot} />
            <GetStartedButton bot={bot} open={intro} setOpen={setIntro} />
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <GetStarted bot={bot} open={intro} setOpen={setIntro} />
        <PolyProfiles />
      </main>
    </div>
  )
}
