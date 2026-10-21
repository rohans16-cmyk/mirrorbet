/** What a Polymarket bet actually is, from its market title and the outcome bought (asked 2026-10-16 after a wrong
 *  buy): "Spread: Washington (-4.5)" + "Purdue" is Purdue +4.5, not Washington. Totals read "Over 61.5", "Will X win"
 *  Yes/No reads "X to win" / "X not to win". Anything else is the outcome as Polymarket names it. polyprofiles.py
 *  pick_label() phrases alerts the same way. */
export function pickLabel(title: string, outcome: string): string {
  const t = title || "";
  const o = (outcome || "").trim();
  const spread = t.match(/Spread:\s*(.+?)\s*\(([-+]?\d+(?:\.\d+)?)\)/i);
  if (spread) {
    const [, fav, line] = spread;
    const n = Math.abs(Number(line));
    const prefix = t.slice(0, spread.index).trim(); // "1H" and the like
    const same = o.toLowerCase() === fav.toLowerCase();
    return `${prefix ? `${prefix} ` : ""}${same ? fav : o} ${same ? "−" : "+"}${n}`;
  }
  const total = t.match(/O\/U\s*(\d+(?:\.\d+)?)/i);
  if (total && /^(over|under)$/i.test(o)) return `${o} ${total[1]}`;
  // "Will the lowest temperature in Atlanta be between 62-63°F on October 16?" + No -> "Atlanta low not 62-63°F"
  const temp = t.match(
    /(highest|lowest) temperature in (.+?) be (?:between )?(.+?) on /i,
  );
  if (temp && /^(yes|no)$/i.test(o))
    return `${temp[2]} ${/^high/i.test(temp[1]) ? "high" : "low"} ${/^no$/i.test(o) ? "not " : ""}${temp[3]}`;
  const win = t.match(/^Will (.+?) win\b/i);
  if (win && /^(yes|no)$/i.test(o))
    return `${win[1]} ${/^yes$/i.test(o) ? "to win" : "not to win"}`;
  // "England vs. Argentina: Both Teams to Score" + "No" -> "Both Teams to Score: No"
  const prop = t.match(/ vs\.? .+?:\s*(.+)$/i);
  if (prop && /^(yes|no)$/i.test(o)) return `${prop[1]}: ${o}`;
  // a plain moneyline, "Eagles vs. Jaguars" + "Eagles"
  if (/ vs\.? /i.test(t) && !t.includes(":") && !/^(yes|no|draw)$/i.test(o))
    return `${o} to win`;
  return o;
}

/** Opens a polymarket.com event on polymarket.us, where the user trades (asked 2026-10-16): the server finds the US
 *  event for this .com one (polyprofiles.us_event) and redirects, falling back to the US search for the title. */
export const eventUrl = (slug: string, title = "") =>
  `/api/polymarket/go?slug=${encodeURIComponent(slug)}&title=${encodeURIComponent(title)}`;
