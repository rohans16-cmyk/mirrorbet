import { useEffect, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, Send } from "lucide-react";

type Phone = {
  ok: boolean;
  on: boolean;
  topic: string;
  min_usd: number;
  sells: boolean;
  profiles?: boolean;
  via: "ntfy" | "telegram";
  tg_bot: string;
  tg_code: string;
  tg_linked: boolean;
  status: { last: { title: string; at: string } | null; error: string | null };
  error?: string;
};
type Person = { wallet: string; name: string; phone_min?: number | null; phone_off?: boolean };

/** Phone pushes for big bets by the people you follow, through your own Telegram bot or the ntfy app, both free
 *  (phonepush.py). Telegram is first: on the user's iPhone ntfy's messages didn't banner until the app was opened. */
export function PhoneAlerts({
  people,
  reload,
}: {
  people: Person[];
  reload: () => unknown;
}) {
  const [d, setD] = useState<Phone | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState("");

  const load = () =>
    fetch("/api/polymarket/phone")
      .then((r) => r.json())
      .then(setD)
      .catch(() => setMsg("Cannot reach the server"));
  useEffect(() => {
    load();
  }, []);
  // a token is saved but no chat yet: check every 3s whether you've tapped Start in Telegram
  const waiting = !!d && d.via === "telegram" && !!d.tg_bot && !d.tg_linked;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(
      () =>
        fetch("/api/polymarket/phone", {
          method: "POST",
          body: JSON.stringify({ action: "tg_link" }),
        })
          .then((r) => r.json())
          .then((x: Phone) => x.ok && x.tg_linked && setD(x))
          .catch(() => null),
      3000,
    );
    return () => clearInterval(id);
  }, [waiting]);

  const save = async (body: object, what: string) => {
    setBusy(what);
    setMsg(null);
    const r: Phone = await fetch("/api/polymarket/phone", {
      method: "POST",
      body: JSON.stringify(body),
    })
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: "Cannot reach the server" }));
    setBusy(null);
    if (!r.ok) return setMsg(r.error || "Failed");
    setD(r);
    if (what === "test") setMsg("Sent. Check your phone.");
  };
  const setMin = async (wallet: string, v: string) => {
    setBusy(wallet);
    await fetch("/api/polymarket/profiles", {
      method: "POST",
      body: JSON.stringify({
        action: "phone_min",
        wallet,
        usd: v.trim() === "" ? null : Number(v),
      }),
    }).catch(() => null);
    await reload();
    setBusy(null);
  };

  if (!d)
    return (
      <div className="flex h-24 items-center justify-center rounded-2xl bg-white/[0.03] ring-1 ring-white/10">
        <Loader2 className="size-4 animate-spin text-zinc-500" />
      </div>
    );

  const input =
    "w-24 rounded-lg bg-white/[0.05] px-2 py-1 text-right text-sm tabular-nums text-white ring-1 ring-white/10 placeholder:text-zinc-500 focus:outline-none focus:ring-violet-400/60";
  // saved when the box loses focus (Enter blurs it), only if it changed
  const commit = (
    e: React.FocusEvent<HTMLInputElement>,
    f: (v: string) => void,
    was: string,
  ) => {
    const v = e.currentTarget.value.trim();
    if (v !== was && (v === "" || Number(v) >= 0)) f(v);
  };
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) =>
    e.key === "Enter" && e.currentTarget.blur();

  return (
    <div className="space-y-4 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">Phone alerts</div>
          <div className="text-xs text-zinc-500">
            Big bets from the people you follow, pushed to your phone. Free.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={d.on}
          aria-label="Phone alerts"
          disabled={busy != null}
          onClick={() => save({ on: !d.on }, "on")}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${d.on ? "bg-emerald-500" : "bg-white/15"}`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${d.on ? "left-[22px]" : "left-0.5"}`}
          />
        </button>
      </div>

      <div className="flex gap-1.5">
        {(
          [
            ["telegram", "Telegram"],
            ["ntfy", "ntfy"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            disabled={busy != null}
            onClick={() => d.via !== v && save({ via: v }, "via")}
            className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 transition ${d.via === v ? "bg-white text-black ring-white" : "text-zinc-400 ring-white/10 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {d.via === "telegram" ? (
      <ol className="space-y-2 text-sm text-zinc-300">
        <li>
          <span className="text-zinc-500">1.</span> In{" "}
          <a href="https://telegram.org/apps" target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">
            Telegram
          </a>
          , message{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">
            @BotFather
          </a>{" "}
          <code className="text-zinc-400">/newbot</code>, pick any name. It replies with a token.
        </li>
        <li>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (token.trim())
                save({ action: "tg_token", token }, "token").then(() => setToken(""));
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-zinc-500">2.</span>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={d.tg_bot ? `@${d.tg_bot} saved · paste to replace` : "Paste the token"}
              className="w-72 rounded-lg bg-white/[0.05] px-2 py-1 font-mono text-sm text-white ring-1 ring-white/10 placeholder:font-sans placeholder:text-zinc-500 focus:outline-none focus:ring-violet-400/60"
            />
            <button
              disabled={busy != null || !token.trim()}
              className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-50"
            >
              {busy === "token" ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
            </button>
          </form>
        </li>
        {d.tg_bot && (
          <li className="flex flex-wrap items-center gap-2">
            <span className="text-zinc-500">3.</span>
            {d.tg_linked ? (
              <span className="flex items-center gap-1.5 text-emerald-300">
                <Check className="size-3.5" /> Linked to @{d.tg_bot}
              </span>
            ) : (
              <>
                <a
                  href={`https://t.me/${d.tg_bot}?start=${d.tg_code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-sky-600 px-3 py-1 text-sm font-semibold text-white transition hover:bg-sky-500"
                >
                  Open @{d.tg_bot}, tap Start
                </a>
                <Loader2 className="size-3.5 animate-spin text-zinc-500" />
                <span className="text-xs text-zinc-500">Waiting for Start</span>
              </>
            )}
            <button
              disabled={busy != null}
              onClick={() => save({ tg_unlink: true }, "unlink")}
              className="text-xs text-zinc-500 hover:text-red-300"
            >
              Unlink
            </button>
          </li>
        )}
      </ol>
      ) : (
      <ol className="space-y-2 text-sm text-zinc-300">
        <li>
          <span className="text-zinc-500">1.</span> Install{" "}
          <a
            href="https://apps.apple.com/app/ntfy/id1625396347"
            target="_blank"
            rel="noreferrer"
            className="text-violet-300 hover:underline"
          >
            ntfy for iPhone
          </a>{" "}
          or{" "}
          <a
            href="https://play.google.com/store/apps/details?id=io.heckel.ntfy"
            target="_blank"
            rel="noreferrer"
            className="text-violet-300 hover:underline"
          >
            Android
          </a>
          .
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span>
            <span className="text-zinc-500">2.</span> Tap +, subscribe to
          </span>
          <code className="rounded-md bg-black/40 px-2 py-0.5 font-mono text-sm text-white ring-1 ring-white/10">
            {d.topic}
          </code>
          <button
            title="Copy"
            onClick={() => {
              navigator.clipboard?.writeText(d.topic);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-full p-1.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-300" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
          <button
            title="New name (resubscribe on your phone after)"
            disabled={busy != null}
            onClick={() => save({ new_topic: true }, "topic")}
            className="rounded-full p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-white"
          >
            {busy === "topic" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </button>
        </li>
      </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={busy != null || (d.via === "telegram" && !d.tg_linked)}
          onClick={() => save({ action: "test" }, "test")}
          className="flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
        >
          {busy === "test" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Send a test
        </button>
        {msg && <span className="text-xs text-zinc-400">{msg}</span>}
      </div>

      <div className="space-y-2 border-t border-white/10 pt-3">
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">
          Bets of at least
          <span className="flex items-center gap-1 text-zinc-500">
            $
            <input
              key={d.min_usd}
              type="number"
              min={0}
              step={100}
              defaultValue={d.min_usd}
              onBlur={(e) =>
                commit(e, (v) => v !== "" && save({ min_usd: Number(v) }, "min"), String(d.min_usd))
              }
              onKeyDown={enter}
              className={input}
            />
          </span>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">
          <span>
            Big bets by people you follow
            <span className="block text-xs text-zinc-500">
              The bot's own buys and sells always push
            </span>
          </span>
          <input
            type="checkbox"
            checked={d.profiles ?? true}
            disabled={busy != null}
            onChange={() => save({ profiles: !(d.profiles ?? true) }, "profiles")}
            className="size-4 accent-violet-500"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">
          Sells too
          <input
            type="checkbox"
            checked={d.sells}
            disabled={busy != null}
            onChange={() => save({ sells: !d.sells }, "sells")}
            className="size-4 accent-violet-500"
          />
        </label>
        {people.length > 1 &&
          people.map((p) => (
            <label
              key={p.wallet}
              className="flex items-center justify-between gap-3 text-sm text-zinc-400"
            >
              <span className="flex min-w-0 items-center gap-2 pl-3">
                <input
                  type="checkbox"
                  checked={!p.phone_off}
                  disabled={busy != null}
                  onChange={async () => {
                    setBusy(p.wallet);
                    await fetch("/api/polymarket/profiles", {
                      method: "POST",
                      body: JSON.stringify({ action: "phone_on", wallet: p.wallet, on: !!p.phone_off }),
                    }).catch(() => null);
                    await reload();
                    setBusy(null);
                  }}
                  className="size-4 accent-violet-500"
                  title="Push this person's bets to your phone"
                />
                <span className={`truncate ${p.phone_off ? "text-zinc-600 line-through" : ""}`}>{p.name}</span>
              </span>
              <span className="flex items-center gap-1 text-zinc-500">
                {busy === p.wallet && <Loader2 className="size-3 animate-spin" />}$
                <input
                  key={String(p.phone_min)}
                  type="number"
                  min={0}
                  step={100}
                  defaultValue={p.phone_min ?? ""}
                  placeholder={d.min_usd.toLocaleString()}
                  onBlur={(e) => commit(e, (v) => setMin(p.wallet, v), String(p.phone_min ?? ""))}
                  onKeyDown={enter}
                  className={input}
                />
              </span>
            </label>
          ))}
        <div className="text-xs text-zinc-500">
          {people.length > 1 && "Blank = the default. "}A muted person (bell off) never
          pushes. Works while the server runs on your Mac.
          {d.status.error
            ? ` Last error: ${d.status.error}`
            : d.status.last
              ? ` Last sent ${new Date(d.status.last.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
              : ""}
        </div>
      </div>
    </div>
  );
}
