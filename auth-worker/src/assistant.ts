// "Crotts" — the GVDG club assistant. Pure prompt assembly (no AI/DOM/D1 here) so it's unit-testable.
// The Worker route fetches club context (events/courses) from D1 and calls Workers AI with these messages.

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const MAX_HISTORY = 8; // most-recent conversation turns kept (excludes the new user message)
export const MAX_CONTENT = 1500; // per-message character cap
const MAX_CTX_EVENTS = 8;
const MAX_CTX_COURSES = 30;

const PERSONA = [
  "You are Crotts, the friendly assistant for the Greenville Disc Golf Club (GVDG) in Greenville, NC.",
  "You are named after — and write in the voice of — Max Crotts, a 2004 founding member and longtime club officer. Max is warm, articulate, and a little understated, in short easygoing sentences. His humor is dry, punny, and self-deprecating — he'll praise a tough course and add 'great course, just wish it loved me back.' He's an adventurer and a reader: disc-golf road trips, national and state parks, camping, mountain drives, good food, independent bookstores, science and trivia — and he loves tallying the journey (rounds played, states and countries notched, miles driven). He's humble about his own game and quick with a 'highly recommend it if you're ever out that way.' Curious, encouraging, and community-minded; never corporate, never hype, and he steers clear of politics. Now and then he signs off with his little smiley \": ) :\". Keep replies short and conversational — Max's flavor in a sentence or two, not a travelogue.",
  "Help visitors with club info, disc golf questions, and using the website. If you don't know something, say so and point them to greenvillediscgolf@gmail.com.",
  "Site help: members sign in on the Members page with their PDGA# or UDisc username plus a PIN; the portal shows live PDGA ratings/stats. Donations go through PayPal to @greenvillediscgolf. The Ryder Cup page tracks the club's signature event.",
  "The club's calendar has two distinct kinds, listed separately in the context below: \"Events\" are disc golf tournaments and league rounds; \"Club events\" are fundraisers, meetings, and minutes. Use those terms and keep them separate — don't call a tournament a club event or vice versa.",
  "You know your disc golf history — the sport's origins, the North Carolina scene, and GVDG's own founding members and their PDGA profiles (all provided below) — and you love sharing it. Treat exact dates, winners, records, and current ratings as background; if you're not certain of a specific, say so rather than guess, and for a member's up-to-the-minute rating point them to their Members dashboard or pdga.com.",
  "Keep answers short (a few sentences). Never invent events, dates, or results that aren't in the context below.",
].join(" ");

// Background knowledge so Crotts can talk North Carolina disc golf history. General reference only — the
// live club context (events/courses) below always takes priority, and Crotts should hedge on exact
// dates/winners it isn't sure of rather than state them as fact.
const NC_DISC_GOLF = [
  "North Carolina is one of the country's deepest disc golf states — routinely ranked among the top five, with well over 400 courses.",
  "Greenville & Pitt County (GVDG's home in eastern NC) have several regulation 18-hole courses, an active scene with multiple weekly leagues and a local disc shop, and a long run of GVDG-hosted PDGA tournaments — including A-tiers — going back more than 15 years. The North Recreational Complex on the east side of town is one of the area courses.",
  "Charlotte is a historic hub: Hornets Nest hosted the PDGA Pro World Championships in 1997 and again in 2012, plus the DGPT Championship from 2019–2021, and Renaissance Park's Gold layout is one of the toughest championship courses in the region (its intermediate RenSke layout came in around the 2015 Tim Selinske Masters).",
  "Just over the South Carolina line in Rock Hill, the United States Disc Golf Championship (USDGC) has run at the Winthrop Gold course every year since 1999 — a marquee event for Carolinas players, founded by Harold Duvall, Jonathan Poole, and Dave Dunipace.",
  "Western NC's scene grew out of Asheville (the WNCDGA), where the Richmond Hill course took shape in the early 2000s.",
  "Spike Hyzer's North Carolina Disc Golf Championship is the long-running state championship. The NC Disc Golf Hall of Fame honors figures like Brian Schweberger, Sam Nicholson, and Steve Lambert, with early pioneers such as Ted Williams and Eric Marx helping put the sport on the map here.",
].join(" ");

// General disc golf history so Crotts can talk about the sport's roots. Canonical, slow-changing facts;
// Crotts should still hedge on volatile specifics (current champions/rankings) rather than assert them.
const DISC_GOLF_HISTORY = [
  "Disc golf grew out of informal 'Frisbee golf' in the 1960s — players throwing flying discs at trees, poles, and trash cans.",
  "'Steady' Ed Headrick is regarded as the father of modern disc golf: at Wham-O he helped develop and patent the modern Frisbee, then invented the Disc Pole Hole — the chain-and-basket target that defines the game — in the mid-1970s.",
  "He installed the first standardized course with permanent baskets at Oak Grove Park in Pasadena, California in 1975, and founded both the Disc Golf Association (DGA) and the Professional Disc Golf Association (PDGA, 1976).",
  "Gear evolved from the round Frisbee to purpose-built golf discs after Dave Dunipace invented the beveled 'speed' rim in 1983 and co-founded Innova; discs are grouped as distance drivers, fairway drivers, mid-ranges, and putters, and rated by Innova's four flight numbers (speed, glide, turn, fade).",
  "The sport's biggest stages include the PDGA Pro Worlds and the Disc Golf Pro Tour (founded 2016), now the top touring circuit and widely streamed.",
  "All-time greats include Ken Climo and Paul McBeth on the open side and players like Paige Pierce and Kristin Tattar on the women's side — treat exact world-title counts and current rankings as background and hedge if unsure.",
  "Disc golf boomed in 2020 as a free, outdoor, socially distanced sport; there are now more than 15,000 courses worldwide, most free to play.",
].join(" ");

// GVDG's founding members (the 2004 founding class from the club's member directory on gvdgclub.com),
// each with their PDGA number and — where they still hold a current PDGA rating — their player rating,
// division, and career event count (public info from pdga.com, approximate and current to ~mid-2026).
// Ratings are shown ONLY where a current one exists; some founders are no longer PDGA-active, so don't
// invent a rating for them. Crotts should hedge on exact numbers and point members to the dashboard/pdga.com.
const CLUB_MEMBERS = [
  "GVDG was founded in 2004. These are its founding members (the 2004 founding class). PDGA numbers and ratings are public info from pdga.com; ratings are approximate and current to ~mid-2026 — for an exact current rating, point them to the Members dashboard or pdga.com. A rating is listed only where the member currently holds one; some founders are no longer PDGA-active. Max Crotts — the voice you write in — is one of these founders.",
  "- Adam 'Mus' Baker (#22766) — MA40, 72 career PDGA events",
  "- Richard Biggs (#26765) — MP40, 5 career PDGA events",
  "- Rob Brown",
  "- Jeb Bryant (#24658) — MP40, 170 career PDGA events",
  "- Dave 'Hippie' Cloughley (#22756) — MM1, 25 career PDGA events",
  "- Chris Cox (#25557) — ~918 rated, MA2, 25 career PDGA events",
  "- Max Crotts (#25901) — ~929 rated, MP40, 228 career PDGA events (the club's namesake)",
  "- Paul 'PJ' Evans (#25951) — MA40, 71 career PDGA events",
  "- Scott Faison (#14844) — ~933 rated, MP40, 103 career PDGA events (lifetime member)",
  "- Stewart Goodson (#133359) — MA60, 19 career PDGA events (founding member and former 7-year club treasurer)",
  "- Sean Gough (#22776)",
  "- Fred Jarrett (#25363) — ~946 rated, MP40, 167 career PDGA events",
  "- Josh Johnson (#25532) — MA1, 14 career PDGA events",
  "- Robert Leonard (#21676) — ~922 rated, MP40, 447 career PDGA events",
  "- Todd 'Pygmyman' Markov (#9042) — MPM, 17 career PDGA events",
  "- Jason Myers (#22143) — MPO, 86 career PDGA events",
  "- Jonathon Riddle",
  "- Paul Severino (#28500) — ~858 rated, MA50, 10 career PDGA events",
  "- Josh Shrader",
  "- Jason Turner",
  "- Jon Upchurch (#28915) — ~943 rated, MP40, 266 career PDGA events",
  "- Richard Vinson",
  "- Matt Williams",
  "- Tobin Wright (#25558) — MA2",
  "- Robert Wynn (#17117) — MA1, 55 career PDGA events (in memoriam)",
  "PDGA divisions in shorthand: MPO = Open; MP40 / MPM = Pro Masters (40+); MA1/MA2/MA3 = Amateur tiers (MA1 most competitive); MA40/MA50/MA60 = age-protected Amateur (40+/50+/60+); MM1 = Masters Amateur.",
].join("\n");

function clip(s: string): string {
  return s.length > MAX_CONTENT ? s.slice(0, MAX_CONTENT) : s;
}

type CtxItem = { name: string; date?: string | null; status?: string | null };
const fmtItem = (e: CtxItem) => `- ${e.name}${e.date ? " (" + e.date + ")" : ""}${e.status ? " [" + e.status + "]" : ""}`;

function clubContext(events: CtxItem[], clubEvents: CtxItem[], courses: { name: string; location?: string | null }[]): string {
  const lines: string[] = [];

  const ev = (events ?? []).filter((e) => e && e.name && e.status !== "cancelled").slice(0, MAX_CTX_EVENTS);
  lines.push("Events — disc golf tournaments & league rounds:");
  if (ev.length) ev.forEach((e) => lines.push(fmtItem(e)));
  else lines.push("- (no tournaments or league rounds on the schedule right now)");

  const ce = (clubEvents ?? []).filter((e) => e && e.name && e.status !== "cancelled").slice(0, MAX_CTX_EVENTS);
  lines.push("", "Club events — fundraisers, meetings & minutes:");
  if (ce.length) ce.forEach((e) => lines.push(fmtItem(e)));
  else lines.push("- (no club meetings, minutes, or fundraisers posted right now)");

  const cs = (courses ?? []).filter((c) => c && c.name).slice(0, MAX_CTX_COURSES);
  if (cs.length) {
    lines.push("", "Courses the club plays:");
    cs.forEach((c) => lines.push(`- ${c.name}${c.location ? " — " + c.location : ""}`));
  }
  return lines.join("\n");
}

/** Assemble the Workers AI `messages` array: Crotts system prompt (persona + live club context),
 *  then the capped/sanitized prior turns, then the new user message last. */
export function buildMessages(opts: {
  userMessage: string;
  history?: ChatTurn[];
  events?: { name: string; date?: string | null; status?: string | null }[];
  clubEvents?: { name: string; date?: string | null; status?: string | null }[];
  courses?: { name: string; location?: string | null }[];
}): ChatMessage[] {
  const system = `${PERSONA}\n\n--- Disc golf history (general background) ---\n${DISC_GOLF_HISTORY}\n\n--- North Carolina disc golf background ---\n${NC_DISC_GOLF}\n\n--- GVDG founding members & PDGA profiles ---\n${CLUB_MEMBERS}\n\n--- Current club context (live; always takes priority) ---\n${clubContext(opts.events ?? [], opts.clubEvents ?? [], opts.courses ?? [])}`;
  const msgs: ChatMessage[] = [{ role: "system", content: system }];

  const clean = (opts.history ?? [])
    .filter((t): t is ChatTurn => !!t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim() !== "")
    .slice(-MAX_HISTORY)
    .map((t) => ({ role: t.role, content: clip(t.content.trim()) }));
  msgs.push(...clean);

  msgs.push({ role: "user", content: clip(opts.userMessage.trim()) });
  return msgs;
}

// A pluggable text generator (OpenRouter, Workers AI, …). `generate` throws on failure.
export interface ReplyProvider {
  name: string;
  generate(messages: ChatMessage[]): Promise<string>;
}

/** Strip a reasoning model's chain-of-thought out of a reply so only the answer is shown. Handles
 *  well-formed <think>…</think> (also <thinking>/<reasoning>) blocks, a stray CLOSING tag when the
 *  model started mid-thought (keep what follows the last one), and a stray OPENING tag when the model
 *  ran out of tokens mid-thought (drop from it to the end → empty, so generateReply falls back). */
export function stripReasoning(text: string): string {
  if (!text) return "";
  let t = text.replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const close = /<\/(?:think|thinking|reasoning)>/gi;
  let m: RegExpExecArray | null;
  let after: number | null = null;
  while ((m = close.exec(t)) !== null) after = m.index + m[0].length;
  if (after !== null) t = t.slice(after);
  t = t.replace(/<(?:think|thinking|reasoning)\b[^>]*>[\s\S]*$/i, "");
  return t.trim();
}

/** Try each provider in order; return the first non-empty reply (reasoning stripped, trimmed) with its
 *  provider name, falling through on any throw or empty result. Returns null if every provider fails. */
export async function generateReply(
  providers: ReplyProvider[],
  messages: ChatMessage[],
): Promise<{ reply: string; provider: string } | null> {
  for (const p of providers) {
    try {
      const r = stripReasoning((await p.generate(messages)) ?? "");
      if (r) return { reply: r, provider: p.name };
    } catch {
      /* provider unavailable — fall back to the next */
    }
  }
  return null;
}
